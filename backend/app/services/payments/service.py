"""Paid parking bookings and their eSewa / Khalti payments.

Guarantees:
  * Price = the facility's own hourly rate x hours, computed here; the apps only choose the hours.
  * A space is held while the driver pays. Holds and bookings are counted against free spaces under a
    row lock on the facility, so two drivers can never be given the last space.
  * A booking is confirmed only after the provider confirmed the payment server-to-server and the
    amount matched to the paisa. Callbacks are never trusted on their own.
  * Every step is idempotent: repeated callbacks, retries and the reconciliation job can run in any
    order; a payment completes once and confirms its booking once (`bookings.paid_payment_id` unique,
    provider transaction ids unique).
  * A payment that succeeded but could not confirm its booking is never lost: it is flagged
    (`payments.reconciliation`), retried, re-reserved when possible, and otherwise marked for refund
    with the driver and administrators told.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from urllib.parse import urlencode, urlsplit
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError, conflict, not_found, unprocessable
from app.models.booking import Booking, Payment
from app.models.enums import (
    OPEN_PAYMENT_STATUSES,
    BookingKind,
    BookingStatus,
    NotificationKind,
    NotificationTone,
    OccupancySource,
    ParkingStatus,
    PaymentProvider,
    PaymentStatus,
    PricingMode,
    ReconciliationState,
    UserRole,
    UserStatus,
)
from app.models.parking import ParkingLocation
from app.models.user import User
from app.services.parking import clamp_available, closes_at_after, is_open_now
from app.services.payments.gateways import (
    KHALTI_MIN_PAISA,
    Esewa,
    GatewayError,
    Khalti,
    ProviderResult,
    SignatureError,
    to_paisa,
)

log = logging.getLogger(__name__)

_TZ = ZoneInfo(settings.timezone)
CENT = Decimal("0.01")
# Open payments are checked with the provider at most this often.
CHECK_INTERVAL = timedelta(seconds=45)
# Payments nobody finished are given up on after this long (the provider session is long gone).
ABANDON_AFTER = timedelta(hours=2)


@dataclass(frozen=True)
class Checkout:
    """What the app needs to send the driver to the provider."""

    payment: Payment
    checkout_url: str


# --------------------------------------------------------------------------- availability and price


def reserved_spaces(session: Session, parking: ParkingLocation, now: datetime, exclude: uuid.UUID | None = None) -> int:
    """Spaces promised to drivers that the live free-space figure does not reflect yet.

    Holds count until they expire. Confirmed bookings count while active; at a facility counted by an
    AI camera, a driver who has arrived is already in the camera's figure, so a confirmed booking only
    counts during the arrival window after it starts.
    """
    arrival_cutoff = now - timedelta(minutes=settings.booking_arrival_window_minutes)
    confirmed_active = and_(Booking.status == BookingStatus.CONFIRMED, Booking.ends_at > now)
    if parking.occupancy_source == OccupancySource.CAMERA:
        confirmed_active = and_(confirmed_active, Booking.starts_at > arrival_cutoff)
    stmt = select(func.count()).where(
        Booking.parking_id == parking.id,
        Booking.kind == BookingKind.INITIAL,
        or_(and_(Booking.status == BookingStatus.PENDING_PAYMENT, Booking.hold_expires_at > now), confirmed_active),
    )
    if exclude is not None:
        stmt = stmt.where(Booking.id != exclude)
    return int(session.scalar(stmt) or 0)


def bookable_spaces(session: Session, parking: ParkingLocation, now: datetime, exclude: uuid.UUID | None = None) -> int:
    free = clamp_available(parking.capacity, parking.available_spaces)
    return max(0, free - reserved_spaces(session, parking, now, exclude))


def price(parking: ParkingLocation, hours: int) -> Decimal:
    if parking.pricing_mode != PricingMode.HOURLY or not parking.price_per_hour or parking.price_per_hour <= 0:
        raise unprocessable("This parking is free to use and does not take bookings.", {"parking_id": "Free parking"})
    return (Decimal(parking.price_per_hour) * hours).quantize(CENT)


def check_bookable(parking: ParkingLocation, hours: int, now: datetime, *, start: datetime | None = None) -> None:
    """Raises a plain-language error when this facility cannot be booked for `hours` from `start`."""
    if not parking.is_published or parking.status in (ParkingStatus.CLOSED, ParkingStatus.SUSPENDED):
        raise conflict("This parking is not taking bookings right now.", "parking_unavailable")
    if not 1 <= hours <= settings.booking_max_hours:
        raise unprocessable(f"Choose between 1 and {settings.booking_max_hours} hours.", {"hours": "Out of range"})
    start = start or now
    if not is_open_now(parking, start):
        raise conflict("This parking is closed at that time.", "parking_closed")
    closing = closes_at_after(parking, start)
    if closing is not None and start + timedelta(hours=hours) > closing:
        left = max(0, int((closing - start).total_seconds() // 3600))
        raise unprocessable(
            f"This parking closes at {closing.strftime('%H:%M')}. You can book up to {left} hour{'s' if left != 1 else ''}.",
            {"hours": "Past closing time"},
        )


# --------------------------------------------------------------------------- bookings


def _lock_parking(session: Session, parking_id: uuid.UUID) -> ParkingLocation:
    parking = session.scalar(
        select(ParkingLocation)
        .where(ParkingLocation.id == parking_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if parking is None or not parking.is_published:
        raise not_found("Parking location")
    return parking


def _lock_booking(session: Session, booking_id: uuid.UUID) -> Booking:
    booking = session.scalar(
        select(Booking).where(Booking.id == booking_id).with_for_update().execution_options(populate_existing=True)
    )
    if booking is None:
        raise not_found("Booking")
    return booking


def _own(booking: Booking, user_id: uuid.UUID) -> None:
    if booking.user_id != user_id:
        raise not_found("Booking")  # never confirm that someone else's booking exists


def create_booking(
    session: Session, user_id: uuid.UUID, parking_id: uuid.UUID, hours: int, vehicle_plate: str | None
) -> Booking:
    """Holds one space for `hours` while the driver pays."""
    now = datetime.now(UTC)
    parking = _lock_parking(session, parking_id)  # serialises every booking for this facility
    amount = price(parking, hours)
    check_bookable(parking, hours, now)
    if settings.khalti_enabled and not settings.esewa_enabled and to_paisa(amount) < KHALTI_MIN_PAISA:
        raise unprocessable("Online payment needs at least Rs 10.", {"hours": "Amount too small"})
    existing = session.scalar(
        select(Booking).where(
            Booking.user_id == user_id,
            Booking.parking_id == parking.id,
            Booking.kind == BookingKind.INITIAL,
            Booking.status == BookingStatus.PENDING_PAYMENT,
        )
    )
    if existing is not None:
        if existing.hold_expires_at and existing.hold_expires_at > now:
            raise AppError(
                409,
                "booking_pending",
                "You already have a booking here waiting for payment. Finish or cancel it first.",
                {"booking_id": str(existing.id)},
            )
        existing.status = BookingStatus.EXPIRED  # an old hold that ran out: make room for the new one
        session.flush()
    if bookable_spaces(session, parking, now) < 1:
        raise conflict("Sorry, there are no free spaces to book here right now.", "no_space")
    booking = Booking(
        user_id=user_id,
        parking_id=parking.id,
        kind=BookingKind.INITIAL,
        status=BookingStatus.PENDING_PAYMENT,
        hours=hours,
        price_per_hour=Decimal(parking.price_per_hour).quantize(CENT),
        amount=amount,
        vehicle_plate=(vehicle_plate or None),
        hold_expires_at=now + timedelta(minutes=settings.booking_hold_minutes),
    )
    session.add(booking)
    session.flush()
    booking.reference = f"BK-{booking.seq}"
    session.commit()
    return booking


def create_extension(session: Session, user_id: uuid.UUID, booking_id: uuid.UUID, hours: int) -> Booking:
    """Adds hours to a confirmed, still running booking. The driver keeps the same space."""
    now = datetime.now(UTC)
    parent = _lock_booking(session, booking_id)
    _own(parent, user_id)
    if parent.kind != BookingKind.INITIAL or parent.status != BookingStatus.CONFIRMED or not parent.ends_at:
        raise conflict("Only a confirmed booking can be extended.", "not_extendable")
    if parent.ends_at <= now:
        raise conflict("This booking has already ended. Book again instead.", "booking_ended")
    pending = session.scalar(
        select(Booking).where(
            Booking.parent_id == parent.id,
            Booking.status == BookingStatus.PENDING_PAYMENT,
            Booking.hold_expires_at > now,
        )
    )
    if pending is not None:
        raise AppError(
            409, "booking_pending", "An extension is already waiting for payment.", {"booking_id": str(pending.id)}
        )
    parking = session.get(ParkingLocation, parent.parking_id)
    assert parking is not None
    amount = price(parking, hours)
    check_bookable(parking, hours, now, start=parent.ends_at)
    extension = Booking(
        user_id=user_id,
        parking_id=parent.parking_id,
        kind=BookingKind.EXTENSION,
        parent_id=parent.id,
        status=BookingStatus.PENDING_PAYMENT,
        hours=hours,
        price_per_hour=Decimal(parking.price_per_hour).quantize(CENT),
        amount=amount,
        vehicle_plate=parent.vehicle_plate,
        hold_expires_at=now + timedelta(minutes=settings.booking_hold_minutes),
    )
    session.add(extension)
    session.flush()
    extension.reference = f"BK-{extension.seq}"
    session.commit()
    return extension


def cancel_booking(session: Session, user_id: uuid.UUID, booking_id: uuid.UUID) -> Booking:
    """Releases a held space. Payments still open at the provider are checked first, so a paid booking is never cancelled."""
    booking = session.get(Booking, booking_id)
    if booking is None:
        raise not_found("Booking")
    _own(booking, user_id)
    open_ids = session.scalars(
        select(Payment.id).where(Payment.booking_id == booking_id, Payment.status.in_(OPEN_PAYMENT_STATUSES))
    ).all()
    for payment_id in open_ids:
        try:
            verify_payment(session, payment_id)
        except GatewayError:
            raise conflict(
                "We could not check your payment with the provider. Try again in a moment before cancelling.",
                "payment_unverified",
            ) from None
    booking = _lock_booking(session, booking_id)
    if booking.status == BookingStatus.CONFIRMED:
        raise conflict("This booking is paid and confirmed, so it cannot be cancelled here.", "already_confirmed")
    if booking.status == BookingStatus.PENDING_PAYMENT:
        booking.status = BookingStatus.CANCELLED
        booking.cancelled_at = datetime.now(UTC)
    session.commit()
    return booking


# --------------------------------------------------------------------------- starting a payment


def validate_return_url(url: str) -> str:
    """Only our own web app or our mobile app may receive the driver after payment (no open redirect)."""
    parts = urlsplit(url)
    if len(url) > 500 or not parts.scheme:
        raise unprocessable("Invalid return address.", {"return_url": "Invalid"})
    if parts.scheme in ("http", "https"):
        origin = f"{parts.scheme}://{parts.netloc}"
        allowed = {o.rstrip("/") for o in [*settings.payment_return_origins, settings.web_app_url]}
        if origin not in allowed:
            raise unprocessable("This return address is not allowed.", {"return_url": "Not allowed"})
    elif parts.scheme not in settings.payment_return_schemes:
        raise unprocessable("This return address is not allowed.", {"return_url": "Not allowed"})
    return url


def provider_enabled(provider: PaymentProvider) -> bool:
    return settings.esewa_enabled if provider == PaymentProvider.ESEWA else settings.khalti_enabled


def start_payment(
    session: Session,
    user_id: uuid.UUID,
    booking_id: uuid.UUID,
    provider: PaymentProvider,
    return_url: str,
    callback_base_url: str,
) -> Checkout:
    """Creates a payment attempt and returns where to send the driver. Retrying creates a new attempt."""
    if not provider_enabled(provider):
        raise conflict(f"{provider_label(provider)} payments are not available right now.", "provider_disabled")
    return_url = validate_return_url(return_url)
    now = datetime.now(UTC)
    booking = _lock_booking(session, booking_id)
    _own(booking, user_id)
    if booking.status == BookingStatus.CONFIRMED:
        raise conflict("This booking is already paid.", "already_paid")
    if booking.status != BookingStatus.PENDING_PAYMENT or (booking.hold_expires_at and booking.hold_expires_at <= now):
        raise conflict("This booking's hold has ended. Please book again.", "hold_expired")
    amount = Decimal(booking.amount).quantize(CENT)
    if provider == PaymentProvider.KHALTI and to_paisa(amount) < KHALTI_MIN_PAISA:
        raise unprocessable(
            "Khalti needs at least Rs 10. Choose more hours or pay with eSewa.", {"provider": "Too small"}
        )
    user = session.get(User, user_id)
    assert user is not None
    payment = Payment(
        booking_id=booking.id,
        user_id=user_id,
        provider=provider,
        status=PaymentStatus.INITIATED,
        amount=amount,
        # Unique per attempt: eSewa and Khalti refuse a reused id, and a retry must never be confused
        # with an earlier attempt.
        transaction_uuid=f"{booking.reference}-{secrets.token_hex(5)}",
        return_url=return_url,
        callback_base_url=callback_base_url.rstrip("/"),
        provider_response={},
    )
    session.add(payment)
    session.flush()
    base = payment.callback_base_url
    if provider == PaymentProvider.ESEWA:
        payment.checkout_url = f"{base}/payments/{payment.id}/esewa/checkout"
        session.commit()
        return Checkout(payment, payment.checkout_url)

    parking = session.get(ParkingLocation, booking.parking_id)
    assert parking is not None
    customer = {"name": user.full_name[:60]}
    if user.email:
        customer["email"] = user.email
    if user.phone:
        customer["phone"] = user.phone.removeprefix("+977")
    session.commit()  # the attempt exists before Khalti is called, so a crash leaves a traceable row
    try:
        khalti_session = Khalti.from_settings().initiate(
            amount=amount,
            purchase_order_id=payment.transaction_uuid,
            purchase_order_name=f"Parking {booking.reference} · {parking.name} · {booking.hours} h",
            return_url=f"{base}/payments/khalti/{payment.id}/return",
            website_url=settings.web_app_url,
            customer=customer,
        )
    except GatewayError as exc:
        payment = session.get(Payment, payment.id)
        assert payment is not None
        payment.status = PaymentStatus.FAILED
        payment.failure_reason = exc.code
        session.commit()
        raise AppError(
            502, "provider_unavailable", "Khalti could not start the payment. Try again or pay with eSewa."
        ) from exc
    payment = session.scalar(select(Payment).where(Payment.id == payment.id).execution_options(populate_existing=True))
    assert payment is not None
    payment.provider_reference = khalti_session.pidx
    payment.checkout_url = khalti_session.payment_url
    payment.provider_expires_at = khalti_session.expires_at
    payment.status = PaymentStatus.PENDING
    session.commit()
    return Checkout(payment, khalti_session.payment_url)


def esewa_form(payment: Payment) -> tuple[str, dict[str, str]]:
    """The signed form the driver's browser posts to eSewa."""
    gateway = Esewa.from_settings()
    base = payment.callback_base_url
    return gateway.form_url, gateway.form_fields(
        transaction_uuid=payment.transaction_uuid,
        amount=Decimal(payment.amount),
        success_url=f"{base}/payments/esewa/{payment.id}/success",
        failure_url=f"{base}/payments/esewa/{payment.id}/failure",
    )


def provider_label(provider: PaymentProvider) -> str:
    return "eSewa" if provider == PaymentProvider.ESEWA else "Khalti"


# --------------------------------------------------------------------------- verification


def _ask_provider(payment: Payment) -> ProviderResult:
    if payment.provider == PaymentProvider.ESEWA:
        return Esewa.from_settings().check_status(
            transaction_uuid=payment.transaction_uuid, amount=Decimal(payment.amount)
        )
    if not payment.provider_reference:
        return ProviderResult("not_found")  # Khalti never created a session for this attempt
    return Khalti.from_settings().lookup(payment.provider_reference)


def verify_payment(session: Session, payment_id: uuid.UUID, *, cancelled_hint: bool = False) -> Payment:
    """Asks the provider for the truth about a payment and applies it. Raises GatewayError if it cannot be reached."""
    payment = session.get(Payment, payment_id)
    if payment is None:
        raise not_found("Payment")
    if payment.status == PaymentStatus.COMPLETED and payment.reconciliation != ReconciliationState.NEEDS_CONFIRMATION:
        return payment  # already final: duplicate callback or retry
    try:
        result = _ask_provider(payment)
    except GatewayError:
        _touch(session, payment_id)
        raise
    return apply_result(session, payment_id, result, cancelled_hint=cancelled_hint)


def _touch(session: Session, payment_id: uuid.UUID) -> None:
    session.rollback()
    payment = session.get(Payment, payment_id)
    if payment is not None:
        payment.last_checked_at = datetime.now(UTC)
        payment.check_count += 1
        if payment.status == PaymentStatus.INITIATED:
            payment.status = PaymentStatus.PENDING  # we tried to confirm it and could not yet
        session.commit()


def handle_esewa_callback(session: Session, payment_id: uuid.UUID, data: str | None, *, success: bool) -> Payment:
    """eSewa sent the driver back. The signed `data` is checked, then the status API decides."""
    payment = session.get(Payment, payment_id)
    if payment is None or payment.provider != PaymentProvider.ESEWA:
        raise not_found("Payment")
    if success and data:
        try:
            Esewa.from_settings().decode_callback(data, transaction_uuid=payment.transaction_uuid)
        except SignatureError as exc:
            # Someone tampered with or replayed the redirect. Ignore it; only eSewa's own answer counts.
            log.warning("Rejected eSewa callback for payment %s: %s", payment_id, exc)
    try:
        return verify_payment(session, payment_id, cancelled_hint=not success)
    except GatewayError:
        session.rollback()
        return session.get(Payment, payment_id)  # type: ignore[return-value] - pending, reconciled later


def handle_khalti_callback(session: Session, payment_id: uuid.UUID, pidx: str | None) -> Payment:
    payment = session.get(Payment, payment_id)
    if payment is None or payment.provider != PaymentProvider.KHALTI:
        raise not_found("Payment")
    if pidx and pidx != payment.provider_reference:
        log.warning("Khalti return for payment %s carried another pidx; ignored.", payment_id)
    try:
        return verify_payment(session, payment_id)
    except GatewayError:
        session.rollback()
        return session.get(Payment, payment_id)  # type: ignore[return-value]


def apply_result(
    session: Session, payment_id: uuid.UUID, result: ProviderResult, *, cancelled_hint: bool = False
) -> Payment:
    """Applies a provider answer under locks (booking, then payment). Idempotent."""
    now = datetime.now(UTC)
    payment = session.get(Payment, payment_id)
    assert payment is not None
    booking = _lock_booking(session, payment.booking_id)
    payment = session.scalar(
        select(Payment).where(Payment.id == payment_id).with_for_update().execution_options(populate_existing=True)
    )
    assert payment is not None
    payment.last_checked_at = now
    payment.check_count += 1
    if result.raw:
        payment.provider_response = result.raw

    if payment.status == PaymentStatus.COMPLETED:
        if payment.reconciliation == ReconciliationState.NEEDS_CONFIRMATION:
            _confirm(session, booking, payment, now)
        session.commit()
        return payment

    if result.state == "completed":
        if result.amount is None or result.amount.quantize(CENT) != Decimal(payment.amount).quantize(CENT):
            # Money moved, but not the amount we asked for: never confirm, flag for a refund.
            payment.status = PaymentStatus.FAILED
            payment.failure_reason = f"amount_mismatch: expected {payment.amount}, provider reported {result.amount}"
            payment.reconciliation = ReconciliationState.REFUND_REQUIRED
            payment.reconciliation_note = "Paid amount does not match the booking."
            session.commit()
            _tell_refund(session, payment, booking)
            return payment
        if result.transaction_id and session.scalar(
            select(Payment.id).where(
                Payment.provider == payment.provider,
                Payment.provider_transaction_id == result.transaction_id,
                Payment.id != payment.id,
            )
        ):
            payment.status = PaymentStatus.FAILED
            payment.failure_reason = "transaction_reused"
            session.commit()
            log.error("Provider transaction %s already used by another payment", result.transaction_id)
            return payment
        payment.status = PaymentStatus.COMPLETED
        payment.provider_transaction_id = result.transaction_id
        payment.completed_at = now
        payment.failure_reason = None
        _confirm(session, booking, payment, now)
        session.commit()
        if payment.reconciliation == ReconciliationState.REFUND_REQUIRED:
            _tell_refund(session, payment, booking)
        elif booking.status == BookingStatus.CONFIRMED and booking.paid_payment_id == payment.id:
            _tell_confirmed(session, booking)
        return payment

    finished = {PaymentStatus.CANCELLED, PaymentStatus.FAILED, PaymentStatus.EXPIRED, PaymentStatus.REFUNDED}
    if payment.status in finished and result.state in ("pending", "not_found"):
        session.commit()  # an inconclusive answer never reopens a finished payment
        return payment
    if result.state == "refunded":
        payment.status = PaymentStatus.REFUNDED
    elif result.state == "cancelled":
        payment.status = PaymentStatus.CANCELLED
    elif result.state == "expired":
        payment.status = PaymentStatus.EXPIRED
    elif result.state == "failed":
        payment.status = PaymentStatus.FAILED
    elif cancelled_hint:
        # The provider sent the driver to the failure page and has no completed payment: they cancelled.
        # (eSewa reports an unpaid checkout as PENDING, or NOT_FOUND when the form never reached it.)
        payment.status = PaymentStatus.CANCELLED
    elif now - payment.created_at > ABANDON_AFTER:
        # Still unpaid long after the provider's checkout session ended: the driver gave up.
        payment.status = PaymentStatus.EXPIRED
    else:
        payment.status = PaymentStatus.PENDING
    if payment.status != PaymentStatus.PENDING:
        payment.failure_reason = payment.failure_reason or result.state
    session.commit()
    return payment


def _confirm(session: Session, booking: Booking, payment: Payment, now: datetime) -> None:
    """Confirms the booking with this completed payment (inside the caller's locks)."""
    if booking.status == BookingStatus.CONFIRMED:
        if booking.paid_payment_id != payment.id:
            # The driver paid twice (two tabs, a retry after a slow redirect). Keep the first; refund this one.
            payment.reconciliation = ReconciliationState.REFUND_REQUIRED
            payment.reconciliation_note = f"Duplicate payment: booking {booking.reference} was already paid."
        else:
            payment.reconciliation = ReconciliationState.NONE
        return
    try:
        with session.begin_nested():
            if booking.kind == BookingKind.EXTENSION:
                parent = _lock_booking(session, booking.parent_id) if booking.parent_id else None
                if parent is None or parent.status != BookingStatus.CONFIRMED or parent.ends_at is None:
                    payment.reconciliation = ReconciliationState.REFUND_REQUIRED
                    payment.reconciliation_note = "The booking this extension belongs to is not active."
                    return
                start = max(parent.ends_at, now)
                booking.starts_at = start
                booking.ends_at = start + timedelta(hours=booking.hours)
                parent.ends_at = booking.ends_at
            else:
                held = (
                    booking.status == BookingStatus.PENDING_PAYMENT
                    and booking.hold_expires_at
                    and booking.hold_expires_at > now
                )
                if not held:
                    # Paid after the hold ran out (slow provider, closed browser): take a space again if one is free.
                    parking = _lock_parking(session, booking.parking_id)
                    if bookable_spaces(session, parking, now, exclude=booking.id) < 1 or not is_open_now(parking, now):
                        payment.reconciliation = ReconciliationState.REFUND_REQUIRED
                        payment.reconciliation_note = "Paid after the hold ended and no space was left."
                        return
                booking.starts_at = now
                booking.ends_at = now + timedelta(hours=booking.hours)
            booking.status = BookingStatus.CONFIRMED
            booking.confirmed_at = now
            booking.paid_payment_id = payment.id
            booking.hold_expires_at = None
            session.flush()
        payment.reconciliation = ReconciliationState.NONE
        payment.reconciliation_note = None
    except AppError as exc:  # e.g. the facility was unpublished meanwhile: cannot be honoured
        payment.reconciliation = ReconciliationState.REFUND_REQUIRED
        payment.reconciliation_note = exc.message[:250]
    except Exception:  # noqa: BLE001 - money is in; never lose it, retry from reconciliation
        log.exception("Could not confirm booking %s for completed payment %s", booking.id, payment.id)
        payment.reconciliation = ReconciliationState.NEEDS_CONFIRMATION
        payment.reconciliation_note = "Payment received; confirming the booking failed and will be retried."


# --------------------------------------------------------------------------- reconciliation


def reconcile(session: Session, limit: int = 25) -> dict[str, int]:
    """Run by the worker every minute. Each step is safe to repeat."""
    now = datetime.now(UTC)
    counts = {"verified": 0, "unreachable": 0, "confirmed": 0, "expired_holds": 0}

    # 1. Payments the driver may have finished without coming back (closed the tab, lost signal).
    open_ids = session.scalars(
        select(Payment.id)
        .where(
            or_(
                and_(Payment.status.in_(OPEN_PAYMENT_STATUSES), Payment.created_at > now - timedelta(hours=48)),
                # A cancel that crossed with a late payment is caught within the hour.
                and_(Payment.status == PaymentStatus.CANCELLED, Payment.created_at > now - timedelta(hours=1)),
            ),
            Payment.created_at < now - timedelta(seconds=60),
            or_(Payment.last_checked_at.is_(None), Payment.last_checked_at < now - CHECK_INTERVAL),
        )
        .order_by(Payment.created_at)
        .limit(limit)
    ).all()
    for payment_id in open_ids:
        try:
            verify_payment(session, payment_id)
            counts["verified"] += 1
        except GatewayError:
            counts["unreachable"] += 1
    # Attempts nobody finished within two days are closed.
    for payment in session.scalars(
        select(Payment).where(
            Payment.status.in_(OPEN_PAYMENT_STATUSES), Payment.created_at <= now - timedelta(hours=48)
        )
    ):
        payment.status = PaymentStatus.EXPIRED
        payment.failure_reason = payment.failure_reason or "abandoned"
    session.commit()

    # 2. Paid, but confirming the booking failed earlier.
    retry_ids = session.scalars(
        select(Payment.id).where(
            Payment.status == PaymentStatus.COMPLETED, Payment.reconciliation == ReconciliationState.NEEDS_CONFIRMATION
        )
    ).all()
    for payment_id in retry_ids:
        payment = apply_result(session, payment_id, ProviderResult("completed"))
        if payment.reconciliation == ReconciliationState.NONE:
            counts["confirmed"] += 1

    # 3. Holds that ran out free their space. A payment that completes later is re-reserved in _confirm.
    expired = session.scalars(
        select(Booking)
        .where(Booking.status == BookingStatus.PENDING_PAYMENT, Booking.hold_expires_at <= now)
        .with_for_update(skip_locked=True)
    ).all()
    for booking in expired:
        booking.status = BookingStatus.EXPIRED
    counts["expired_holds"] = len(expired)
    session.commit()
    return counts


# --------------------------------------------------------------------------- notifications


def _tell_confirmed(session: Session, booking: Booking) -> None:
    from app.worker.tasks import notify

    parking = session.get(ParkingLocation, booking.parking_id)
    until = booking.ends_at.astimezone(_TZ).strftime("%H:%M") if booking.ends_at else ""
    title = "Parking extended" if booking.kind == BookingKind.EXTENSION else "Parking booked"
    notify(
        booking.user_id,
        NotificationKind.BOOKING_UPDATE,
        NotificationTone.SUCCESS,
        title,
        f"{booking.reference} at {parking.name if parking else 'your parking'} is paid. Valid until {until}.",
        "booking",
        booking.parent_id or booking.id,
    )


def _tell_refund(session: Session, payment: Payment, booking: Booking) -> None:
    from app.worker.tasks import notify

    notify(
        payment.user_id,
        NotificationKind.BOOKING_UPDATE,
        NotificationTone.WARNING,
        "Payment received, booking not confirmed",
        f"We received Rs {payment.amount} for {booking.reference} but could not confirm it "
        f"({payment.reconciliation_note or 'see booking'}). It will be refunded; no action is needed.",
        "booking",
        booking.parent_id or booking.id,
    )
    admins = session.scalars(select(User.id).where(User.role == UserRole.ADMIN, User.status == UserStatus.ACTIVE)).all()
    for admin_id in admins:
        notify(
            admin_id,
            NotificationKind.SYSTEM,
            NotificationTone.WARNING,
            "Payment needs a refund",
            f"{provider_label(payment.provider)} payment {payment.transaction_uuid} (Rs {payment.amount}) for "
            f"{booking.reference}: {payment.reconciliation_note}",
            "payment",
            payment.id,
        )


def result_redirect(payment: Payment) -> str:
    """The driver's return address with the outcome attached."""
    joiner = "&" if "?" in payment.return_url else "?"
    status = payment.status.value
    if payment.status == PaymentStatus.COMPLETED and payment.reconciliation != ReconciliationState.NONE:
        status = "needs_attention"
    return f"{payment.return_url}{joiner}{urlencode({'payment': status, 'payment_id': str(payment.id)})}"
