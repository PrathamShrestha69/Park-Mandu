"""Paid parking: quotes, bookings, extensions, eSewa / Khalti payments and their return URLs.

The provider return URLs (`/payments/esewa/...`, `/payments/khalti/...`) are opened by the driver's
browser, so they carry no session. They never trust what is in the URL: every outcome is confirmed
with the provider server-to-server before anything changes.
"""

import asyncio
import html
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import AdminUser, CurrentUser, DbSession, PublicUser, client_ip
from app.core.config import settings
from app.core.errors import AppError, conflict, not_found
from app.core.rate_limit import limiter
from app.db.session import SyncSessionLocal
from app.models.booking import Booking, Payment
from app.models.enums import (
    OPEN_PAYMENT_STATUSES,
    BookingKind,
    BookingStatus,
    PaymentProvider,
    PaymentStatus,
    ReconciliationState,
)
from app.models.parking import ParkingLocation
from app.models.user import User
from app.schemas.booking import (
    BookingCreate,
    BookingDetail,
    BookingFilters,
    BookingQuote,
    BookingSummary,
    CheckoutOut,
    DisplayStatus,
    ExtensionCreate,
    PaymentOut,
    PaymentStart,
    ProviderOut,
    ReconciliationItem,
    ResolveRequest,
)
from app.services import audit
from app.services.parking import closes_at_after, is_open_now
from app.services.payments import service
from app.services.payments.gateways import KHALTI_MIN_PAISA, GatewayError
from app.utils.pagination import Page, paginate

router = APIRouter(tags=["bookings"])

PAYMENT_LINK_LIFETIME = timedelta(hours=2)


# --------------------------------------------------------------------------- helpers


def _in_thread(fn, *args, **kwargs):  # type: ignore[no-untyped-def]
    """Runs payment work in a sync session (row locks + provider HTTP calls), like dispatch does."""

    def work():  # type: ignore[no-untyped-def]
        with SyncSessionLocal() as session:
            result = fn(session, *args, **kwargs)
            if isinstance(result, Booking | Payment):
                session.refresh(result)
                session.expunge(result)
            elif isinstance(result, service.Checkout):
                session.refresh(result.payment)
                session.expunge(result.payment)
            return result

    return asyncio.to_thread(work)


def _callback_base(request: Request) -> str:
    if settings.payment_callback_base_url:
        return settings.payment_callback_base_url.rstrip("/")
    return f"{str(request.base_url).rstrip('/')}{settings.api_prefix}"


def _providers() -> list[ProviderOut]:
    return [
        ProviderOut(
            id=PaymentProvider.ESEWA,
            label="eSewa",
            enabled=settings.esewa_enabled,
            min_amount=Decimal("1.00"),
            environment=settings.esewa_environment,
        ),
        ProviderOut(
            id=PaymentProvider.KHALTI,
            label="Khalti",
            enabled=settings.khalti_enabled,
            min_amount=Decimal(KHALTI_MIN_PAISA) / 100,
            environment=settings.khalti_environment,
        ),
    ]


def payment_out(payment: Payment) -> PaymentOut:
    open_ = payment.status in OPEN_PAYMENT_STATUSES and payment.created_at > datetime.now(UTC) - PAYMENT_LINK_LIFETIME
    return PaymentOut.model_validate(
        {
            **{k: getattr(payment, k) for k in PaymentOut.model_fields if k not in ("provider_label", "checkout_url")},
            "provider_label": service.provider_label(payment.provider),
            "checkout_url": payment.checkout_url if open_ else None,
        }
    )


def _display_status(booking: Booking, payments: list[Payment], now: datetime) -> DisplayStatus:
    # Money in, booking not honoured (a duplicate payment on a confirmed booking is just refunded quietly).
    flagged = {ReconciliationState.REFUND_REQUIRED, ReconciliationState.NEEDS_CONFIRMATION}
    stuck = any(p.reconciliation == ReconciliationState.NEEDS_CONFIRMATION for p in payments)
    if any(p.reconciliation in flagged for p in payments) and (booking.status != BookingStatus.CONFIRMED or stuck):
        return "needs_attention"
    if booking.status == BookingStatus.CONFIRMED:
        return "active" if booking.ends_at and booking.ends_at > now else "ended"
    if booking.status == BookingStatus.PENDING_PAYMENT:
        if booking.hold_expires_at and booking.hold_expires_at <= now:
            return "expired"
        recent = now - timedelta(minutes=30)
        if any(p.status == PaymentStatus.PENDING and p.created_at > recent for p in payments):
            return "payment_pending"
        return "awaiting_payment"
    return "cancelled" if booking.status == BookingStatus.CANCELLED else "expired"


def _summary(booking: Booking, parking: ParkingLocation, payments: list[Payment], now: datetime) -> dict[str, Any]:
    return {
        # "parking" is a lazy="raise" relationship: excluded before hasattr() would try to load it.
        **{k: getattr(booking, k) for k in BookingSummary.model_fields if k != "parking" and hasattr(booking, k)},
        "display_status": _display_status(booking, payments, now),
        "parking": {
            "id": parking.id,
            "name": parking.name,
            "address": parking.address,
            "latitude": parking.latitude,
            "longitude": parking.longitude,
        },
    }


async def _detail(db: DbSession, booking_id: uuid.UUID, user_id: uuid.UUID) -> BookingDetail:
    """Never pass a loaded User: endpoints roll back before sync work, which expires it."""
    booking = await db.scalar(
        select(Booking)
        .options(selectinload(Booking.parking), selectinload(Booking.payments))
        .where(Booking.id == booking_id)
        .execution_options(populate_existing=True)
    )
    if booking is None or booking.user_id != user_id:
        raise not_found("Booking")
    if booking.kind == BookingKind.EXTENSION and booking.parent_id:
        return await _detail(db, booking.parent_id, user_id)  # extensions are shown on their booking
    extensions = (
        await db.scalars(
            select(Booking)
            .options(selectinload(Booking.payments))
            .where(Booking.parent_id == booking.id)
            .order_by(Booking.created_at)
            .execution_options(populate_existing=True)
        )
    ).all()
    now = datetime.now(UTC)
    payments = sorted([*booking.payments, *(p for e in extensions for p in e.payments)], key=lambda p: p.created_at)
    latest = payments[-1] if payments else None
    parking = booking.parking
    active = booking.status == BookingStatus.CONFIRMED and booking.ends_at is not None and booking.ends_at > now
    closing = closes_at_after(parking, booking.ends_at) if active and booking.ends_at else None
    max_ext = settings.booking_max_hours
    if closing is not None and booking.ends_at is not None:
        max_ext = min(max_ext, max(0, int((closing - booking.ends_at).total_seconds() // 3600)))
    pending_ext = next(
        (e for e in extensions if e.status == BookingStatus.PENDING_PAYMENT and e.hold_expires_at and e.hold_expires_at > now),
        None,
    )
    return BookingDetail.model_validate(
        {
            **_summary(booking, parking, booking.payments, now),
            "payments": [payment_out(p) for p in reversed(payments)],
            "extensions": [_summary(e, parking, e.payments, now) for e in extensions],
            "latest_payment": payment_out(latest) if latest else None,
            "can_pay": booking.status == BookingStatus.PENDING_PAYMENT
            and booking.hold_expires_at is not None
            and booking.hold_expires_at > now,
            "can_cancel": booking.status == BookingStatus.PENDING_PAYMENT,
            "can_extend": active and pending_ext is None and max_ext >= 1 and is_open_now(parking, booking.ends_at),
            "max_extension_hours": max_ext,
        }
    )


# --------------------------------------------------------------------------- quotes and bookings


@router.get("/payments/providers", response_model=list[ProviderOut], summary="Payment methods this server accepts")
async def providers() -> list[ProviderOut]:
    return _providers()


@router.get("/parkings/{parking_id}/booking-quote", response_model=BookingQuote, summary="Price for a number of hours")
async def booking_quote(
    parking_id: uuid.UUID, db: DbSession, hours: Annotated[int, Query(ge=1, le=24)] = 1
) -> BookingQuote:
    parking = await db.get(ParkingLocation, parking_id)
    if parking is None or not parking.is_published:
        raise not_found("Parking location")

    def compute(session: Session) -> tuple[Decimal, int]:
        fresh = session.get(ParkingLocation, parking_id)
        assert fresh is not None
        amount = service.price(fresh, hours)
        service.check_bookable(fresh, hours, datetime.now(UTC))
        return amount, service.bookable_spaces(session, fresh, datetime.now(UTC))

    amount, free = await _in_thread(compute)
    closing = closes_at_after(parking, datetime.now(UTC))
    max_hours = settings.booking_max_hours
    if closing is not None:
        max_hours = min(max_hours, max(0, int((closing - datetime.now(UTC)).total_seconds() // 3600)))
    return BookingQuote(
        parking_id=parking.id,
        hours=hours,
        price_per_hour=Decimal(parking.price_per_hour or 0).quantize(Decimal("0.01")),
        amount=amount,
        bookable_spaces=free,
        max_hours=max_hours,
        closes_at=closing,
        hold_minutes=settings.booking_hold_minutes,
        providers=_providers(),
    )


@router.post("/bookings", response_model=BookingDetail, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def create_booking(request: Request, body: BookingCreate, user: PublicUser, db: DbSession) -> BookingDetail:
    if not settings.payments_enabled:
        raise conflict("Online booking is switched off.", "payments_disabled")
    user_id = user.id
    await db.rollback()
    booking = await _in_thread(service.create_booking, user_id, body.parking_id, body.hours, body.vehicle_plate)
    return await _detail(db, booking.id, user_id)


@router.get("/bookings", response_model=Page[BookingSummary])
async def my_bookings(filters: Annotated[BookingFilters, Query()], user: CurrentUser, db: DbSession) -> dict[str, Any]:
    now = datetime.now(UTC)
    stmt = (
        select(Booking)
        .options(selectinload(Booking.parking), selectinload(Booking.payments))
        .where(Booking.user_id == user.id, Booking.kind == BookingKind.INITIAL)
    )
    if filters.scope == "active":
        stmt = stmt.where(
            (Booking.status == BookingStatus.PENDING_PAYMENT) | ((Booking.status == BookingStatus.CONFIRMED) & (Booking.ends_at > now))
        )
    elif filters.scope == "past":
        stmt = stmt.where(
            (Booking.status.in_([BookingStatus.EXPIRED, BookingStatus.CANCELLED]))
            | ((Booking.status == BookingStatus.CONFIRMED) & (Booking.ends_at <= now))
        )
    stmt = stmt.order_by(Booking.created_at.desc(), Booking.id)
    return await paginate(
        db, stmt, filters, transform=lambda b: BookingSummary.model_validate(_summary(b, b.parking, b.payments, now))
    )


@router.get("/bookings/{booking_id}", response_model=BookingDetail)
async def get_booking(booking_id: uuid.UUID, user: CurrentUser, db: DbSession) -> BookingDetail:
    return await _detail(db, booking_id, user.id)


@router.post("/bookings/{booking_id}/cancel", response_model=BookingDetail)
async def cancel_booking(booking_id: uuid.UUID, user: CurrentUser, db: DbSession) -> BookingDetail:
    user_id = user.id
    await db.rollback()
    await _in_thread(service.cancel_booking, user_id, booking_id)
    return await _detail(db, booking_id, user_id)


@router.post("/bookings/{booking_id}/extend", response_model=BookingDetail, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def extend_booking(
    request: Request, booking_id: uuid.UUID, body: ExtensionCreate, user: PublicUser, db: DbSession
) -> BookingDetail:
    user_id = user.id
    await db.rollback()
    await _in_thread(service.create_extension, user_id, booking_id, body.hours)
    return await _detail(db, booking_id, user_id)


# --------------------------------------------------------------------------- payments


@router.post("/bookings/{booking_id}/payments", response_model=CheckoutOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("15/minute")
async def start_payment(
    request: Request, booking_id: uuid.UUID, body: PaymentStart, user: PublicUser, db: DbSession
) -> CheckoutOut:
    """Pay for a booking (or an extension: pass the extension's id). Retrying starts a new attempt."""
    user_id = user.id
    await db.rollback()
    checkout = await _in_thread(
        service.start_payment, user_id, booking_id, body.provider, body.return_url, _callback_base(request)
    )
    return CheckoutOut(booking_id=booking_id, payment=payment_out(checkout.payment), checkout_url=checkout.checkout_url)


@router.post("/payments/{payment_id}/verify", response_model=BookingDetail, summary="Ask the provider again")
@limiter.limit("12/minute")
async def verify_payment(request: Request, payment_id: uuid.UUID, user: CurrentUser, db: DbSession) -> BookingDetail:
    payment = await db.get(Payment, payment_id)
    user_id = user.id
    if payment is None or payment.user_id != user_id:
        raise not_found("Payment")
    booking_id = payment.booking_id
    await db.rollback()
    try:
        await _in_thread(service.verify_payment, payment_id)
    except GatewayError as exc:
        raise AppError(
            status.HTTP_502_BAD_GATEWAY,
            "provider_unavailable",
            "We could not reach the payment provider. Your payment is safe; we will keep checking.",
        ) from exc
    return await _detail(db, booking_id, user_id)


def _redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/payments/{payment_id}/esewa/checkout", response_class=HTMLResponse, response_model=None, include_in_schema=False)
@limiter.limit("30/minute")
async def esewa_checkout(request: Request, payment_id: uuid.UUID, db: DbSession) -> HTMLResponse | RedirectResponse:
    """A tiny page that posts the signed form to eSewa (eSewa only accepts a browser form POST)."""
    payment = await db.get(Payment, payment_id)
    if payment is None or payment.provider != PaymentProvider.ESEWA:
        raise not_found("Payment")
    if payment.status not in OPEN_PAYMENT_STATUSES or payment.created_at < datetime.now(UTC) - PAYMENT_LINK_LIFETIME:
        return _redirect(service.result_redirect(payment))
    booking = await db.get(Booking, payment.booking_id)
    if booking is None or booking.status != BookingStatus.PENDING_PAYMENT:
        return _redirect(service.result_redirect(payment))
    action, fields = service.esewa_form(payment)
    nonce = secrets.token_urlsafe(16)
    inputs = "".join(
        f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(v)}">' for k, v in fields.items()
    )
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Redirecting to eSewa</title>
<style>body{{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1f2937}}
main{{text-align:center;padding:24px}}button{{font:600 16px system-ui;padding:12px 22px;border:0;border-radius:10px;
background:#60bb46;color:#fff}}</style></head><body><main>
<p>Taking you to eSewa to pay <strong>Rs {html.escape(fields["total_amount"])}</strong>
for booking {html.escape(booking.reference or "")}…</p>
<form id="pay" method="POST" action="{html.escape(action)}">{inputs}
<button type="submit">Continue to eSewa</button></form></main>
<script nonce="{nonce}">document.getElementById('pay').submit();</script></body></html>"""
    origin = "/".join(action.split("/")[:3])
    return HTMLResponse(
        page,
        headers={
            "Content-Security-Policy": f"default-src 'none'; style-src 'unsafe-inline'; "
            f"script-src 'nonce-{nonce}'; form-action {origin}; base-uri 'none'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
        },
    )


@router.get("/payments/esewa/{payment_id}/success", include_in_schema=False)
@limiter.limit("30/minute")
async def esewa_success(
    request: Request, payment_id: uuid.UUID, data: Annotated[str | None, Query(max_length=4000)] = None
) -> RedirectResponse:
    payment = await _in_thread(service.handle_esewa_callback, payment_id, data, success=True)
    return _redirect(service.result_redirect(payment))


@router.get("/payments/esewa/{payment_id}/failure", include_in_schema=False)
@limiter.limit("30/minute")
async def esewa_failure(request: Request, payment_id: uuid.UUID) -> RedirectResponse:
    payment = await _in_thread(service.handle_esewa_callback, payment_id, None, success=False)
    return _redirect(service.result_redirect(payment))


@router.get("/payments/khalti/{payment_id}/return", include_in_schema=False)
@limiter.limit("30/minute")
async def khalti_return(
    request: Request, payment_id: uuid.UUID, pidx: Annotated[str | None, Query(max_length=64)] = None
) -> RedirectResponse:
    payment = await _in_thread(service.handle_khalti_callback, payment_id, pidx)
    return _redirect(service.result_redirect(payment))


# --------------------------------------------------------------------------- administrators: reconciliation


@router.get("/admin/payments/reconciliation", response_model=list[ReconciliationItem], tags=["admin"])
async def reconciliation_queue(_: AdminUser, db: DbSession) -> list[ReconciliationItem]:
    """Payments that took money but did not end in a confirmed booking: refund or confirm by hand."""
    rows = (
        await db.execute(
            select(Payment, Booking, User.full_name, ParkingLocation.name)
            .join(Booking, Booking.id == Payment.booking_id)
            .join(User, User.id == Payment.user_id)
            .join(ParkingLocation, ParkingLocation.id == Booking.parking_id)
            .where(
                Payment.reconciliation.in_(
                    [ReconciliationState.NEEDS_CONFIRMATION, ReconciliationState.REFUND_REQUIRED]
                )
            )
            .order_by(Payment.created_at)
            .limit(200)
        )
    ).all()
    return [
        ReconciliationItem(
            payment=payment_out(p), booking_reference=b.reference, booking_id=b.id, user_name=name, parking_name=pname
        )
        for p, b, name, pname in rows
    ]


@router.post("/admin/payments/{payment_id}/recheck", response_model=PaymentOut, tags=["admin"])
async def admin_recheck(payment_id: uuid.UUID, _: AdminUser, db: DbSession) -> PaymentOut:
    await db.rollback()
    try:
        payment = await _in_thread(service.verify_payment, payment_id)
    except GatewayError as exc:
        raise AppError(status.HTTP_502_BAD_GATEWAY, "provider_unavailable", "The provider could not be reached.") from exc
    return payment_out(payment)


@router.post("/admin/payments/{payment_id}/resolve", response_model=PaymentOut, tags=["admin"])
async def admin_resolve(
    request: Request, payment_id: uuid.UUID, body: ResolveRequest, admin: AdminUser, db: DbSession
) -> PaymentOut:
    """Records that an administrator settled the payment (refunded at the provider, or honoured manually)."""
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id).with_for_update())
    if payment is None:
        raise not_found("Payment")
    if payment.reconciliation == ReconciliationState.NONE:
        raise conflict("This payment does not need reconciling.", "nothing_to_resolve")
    payment.reconciliation = ReconciliationState.RESOLVED
    payment.reconciliation_note = body.note.strip()
    audit.record(
        db,
        actor=admin,
        action="payment.reconciled",
        entity_type="payment",
        entity_id=payment.id,
        ip_address=client_ip(request),
        note=body.note,
    )
    await db.commit()
    await db.refresh(payment)
    return payment_out(payment)
