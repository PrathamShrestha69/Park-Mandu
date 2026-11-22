"""Database-backed flows for paid bookings and traffic-aware parking alerts.

Runs against the running stack:  docker compose exec api pytest tests/test_feature_flows.py -q

Payments: only the provider's HTTP answer is scripted (no real money moves); locking, idempotency,
reconciliation and booking confirmation run for real in PostgreSQL.
Parking alerts: real HTTP calls to /ingest/telemetry and /ingest/parking-status, judged by the worker.
"""

import os
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from datetime import time as dtime
from decimal import Decimal

import httpx
import pytest
from redis import Redis
from sqlalchemy import delete, select, update

from app.core.config import settings
from app.core.errors import AppError
from app.db.session import SyncSessionLocal
from app.models.booking import Booking, Payment
from app.models.enums import (
    AvailableDays,
    BookingStatus,
    EnforcementDecision,
    ParkingCategory,
    ParkingStatus,
    ParkingType,
    PaymentProvider,
    PaymentStatus,
    PricingMode,
    ReconciliationState,
    UserRole,
)
from app.models.monitoring import Alert, Camera, ParkedVehicle
from app.models.parking import ParkingLocation
from app.models.user import User
from app.services.payments import service
from app.services.payments.gateways import KhaltiSession, ProviderResult

BASE = os.environ.get("API_BASE_URL", "http://localhost:8000") + "/api/v1"
RETURN_URL = "http://localhost:3000/bookings/test"
CALLBACK = "http://localhost:8000/api/v1"


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def lot():
    """A 24-hour, Rs 50/hour facility with two free spaces, and two drivers. Removed afterwards."""
    tag = uuid.uuid4().hex[:6]
    with SyncSessionLocal() as s:
        drivers = [
            User(full_name=f"Test Driver {tag}{i}", email=f"driver{i}-{tag}@example.test", password_hash="x", role=UserRole.PUBLIC)
            for i in (1, 2)
        ]
        parking = ParkingLocation(
            name=f"Test Lot {tag}",
            address="Test address",
            area="Test",
            category=ParkingCategory.PRIVATE,
            parking_type=ParkingType.OPEN_AIR,
            capacity=2,
            available_spaces=2,
            opens_at=dtime(0, 0),
            closes_at=dtime(0, 0),  # round the clock
            available_days=AvailableDays.EVERY_DAY,
            pricing_mode=PricingMode.HOURLY,
            price_per_hour=Decimal("50.00"),
            managed_by="Test",
            status=ParkingStatus.OPEN,
            is_published=True,
            latitude=27.7,
            longitude=85.32,
        )
        s.add_all([*drivers, parking])
        s.commit()
        ids = (parking.id, drivers[0].id, drivers[1].id)
    yield ids
    with SyncSessionLocal() as s:
        s.execute(update(Booking).where(Booking.parking_id == ids[0]).values(paid_payment_id=None))
        s.execute(delete(Payment).where(Payment.booking_id.in_(select(Booking.id).where(Booking.parking_id == ids[0]))))
        s.execute(delete(Booking).where(Booking.parking_id == ids[0], Booking.parent_id.is_not(None)))
        s.execute(delete(Booking).where(Booking.parking_id == ids[0]))
        s.execute(delete(ParkingLocation).where(ParkingLocation.id == ids[0]))
        s.execute(delete(User).where(User.id.in_(ids[1:])))
        s.commit()


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch):
    """Scripts what eSewa / Khalti answer. Set `answer.result` before verifying."""

    class Answer:
        result = ProviderResult("pending")
        calls = 0

    answer = Answer()

    def ask(payment: Payment) -> ProviderResult:
        answer.calls += 1
        return answer.result

    class FakeKhalti:
        def initiate(self, **kwargs) -> KhaltiSession:  # type: ignore[no-untyped-def]
            return KhaltiSession(pidx=f"pidx-{uuid.uuid4().hex[:10]}", payment_url="https://khalti.test/pay", expires_at=None)

    monkeypatch.setattr(service, "_ask_provider", ask)
    monkeypatch.setattr(settings, "khalti_secret_key", "test-only")
    monkeypatch.setattr(service.Khalti, "from_settings", classmethod(lambda cls: FakeKhalti()))
    return answer


def book(parking_id: uuid.UUID, user_id: uuid.UUID, hours: int = 2) -> Booking:
    with SyncSessionLocal() as s:
        booking = service.create_booking(s, user_id, parking_id, hours, "Ba 1 Pa 1234")
        s.refresh(booking)
        return booking


def pay(booking: Booking, provider: PaymentProvider = PaymentProvider.ESEWA) -> Payment:
    with SyncSessionLocal() as s:
        checkout = service.start_payment(s, booking.user_id, booking.id, provider, RETURN_URL, CALLBACK)
        s.refresh(checkout.payment)
        return checkout.payment


def verify(payment_id: uuid.UUID, **kw) -> Payment:  # type: ignore[no-untyped-def]
    with SyncSessionLocal() as s:
        payment = service.verify_payment(s, payment_id, **kw)
        s.refresh(payment)
        return payment


def load(booking_id: uuid.UUID) -> Booking:
    with SyncSessionLocal() as s:
        booking = s.get(Booking, booking_id)
        assert booking is not None
        return booking


def completed(amount: str = "100.00", txn: str | None = None) -> ProviderResult:
    return ProviderResult("completed", amount=Decimal(amount), transaction_id=txn or f"T-{uuid.uuid4().hex[:8]}")


# --------------------------------------------------------------------------- payments


def test_price_is_the_hourly_rate_times_hours(lot) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id, hours=3)
    assert booking.amount == Decimal("150.00") and booking.price_per_hour == Decimal("50.00")
    assert booking.status == BookingStatus.PENDING_PAYMENT and booking.hold_expires_at is not None


def test_successful_esewa_payment_confirms_booking(lot, provider) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id)
    payment = pay(booking)
    assert payment.checkout_url.endswith(f"/payments/{payment.id}/esewa/checkout")
    with SyncSessionLocal() as s:
        action, fields = service.esewa_form(s.get(Payment, payment.id))  # type: ignore[arg-type]
    assert fields["total_amount"] == "100" and fields["transaction_uuid"] == payment.transaction_uuid
    assert settings.esewa_secret_key not in str(fields)

    provider.result = completed()
    payment = verify(payment.id)
    booking = load(booking.id)
    assert payment.status == PaymentStatus.COMPLETED
    assert booking.status == BookingStatus.CONFIRMED and booking.paid_payment_id == payment.id
    assert booking.ends_at - booking.starts_at == timedelta(hours=2)  # type: ignore[operator]


def test_failed_esewa_payment_leaves_booking_payable(lot, provider) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id)
    payment = pay(booking)
    provider.result = ProviderResult("failed")
    assert verify(payment.id).status == PaymentStatus.FAILED
    assert load(booking.id).status == BookingStatus.PENDING_PAYMENT


def test_cancelled_at_esewa(lot, provider) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id)
    payment = pay(booking)
    provider.result = ProviderResult("pending")  # what eSewa reports for an unpaid checkout
    with SyncSessionLocal() as s:
        result = service.handle_esewa_callback(s, payment.id, None, success=False)
        assert result.status == PaymentStatus.CANCELLED
        assert "payment=cancelled" in service.result_redirect(result)
    # A later inconclusive check never reopens it.
    assert verify(payment.id).status == PaymentStatus.CANCELLED


def test_successful_and_failed_khalti_payments(lot, provider) -> None:
    parking_id, user_id, other_id = lot
    good = book(parking_id, user_id)
    payment = pay(good, PaymentProvider.KHALTI)
    assert payment.status == PaymentStatus.PENDING and payment.provider_reference.startswith("pidx-")
    provider.result = completed()
    assert verify(payment.id).status == PaymentStatus.COMPLETED
    assert load(good.id).status == BookingStatus.CONFIRMED

    bad = book(parking_id, other_id)
    payment = pay(bad, PaymentProvider.KHALTI)
    provider.result = ProviderResult("cancelled")  # "User canceled"
    with SyncSessionLocal() as s:
        assert service.handle_khalti_callback(s, payment.id, "forged-pidx").status == PaymentStatus.CANCELLED
    assert load(bad.id).status == BookingStatus.PENDING_PAYMENT


def test_duplicate_callbacks_confirm_once(lot, provider) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id)
    payment = pay(booking)
    provider.result = completed(txn="DUP-1")
    first = verify(payment.id)
    calls = provider.calls
    second = verify(payment.id)  # repeated callback: answered from the database
    assert first.status == second.status == PaymentStatus.COMPLETED
    assert provider.calls == calls, "a completed payment is not re-verified"
    booking = load(booking.id)
    assert booking.paid_payment_id == payment.id and second.reconciliation == ReconciliationState.NONE


def test_wrong_amount_is_never_confirmed(lot, provider) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id)
    payment = pay(booking)
    provider.result = completed(amount="10.00")
    payment = verify(payment.id)
    assert payment.status == PaymentStatus.FAILED and payment.failure_reason.startswith("amount_mismatch")
    assert payment.reconciliation == ReconciliationState.REFUND_REQUIRED
    assert load(booking.id).status == BookingStatus.PENDING_PAYMENT


def test_reused_provider_transaction_is_rejected(lot, provider) -> None:
    parking_id, user_id, other_id = lot
    first = pay(book(parking_id, user_id))
    provider.result = completed(txn="SAME-TXN")
    verify(first.id)
    second_booking = book(parking_id, other_id)
    second = verify(pay(second_booking).id)
    assert second.status == PaymentStatus.FAILED and second.failure_reason == "transaction_reused"
    assert load(second_booking.id).status == BookingStatus.PENDING_PAYMENT


def test_expired_payment_and_expired_hold(lot, provider) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id)
    payment = pay(booking, PaymentProvider.KHALTI)
    provider.result = ProviderResult("expired")
    assert verify(payment.id).status == PaymentStatus.EXPIRED
    with SyncSessionLocal() as s:
        s.execute(update(Booking).where(Booking.id == booking.id).values(hold_expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        s.commit()
        service.reconcile(s)
    assert load(booking.id).status == BookingStatus.EXPIRED
    with SyncSessionLocal() as s, pytest.raises(AppError) as err:
        service.start_payment(s, user_id, booking.id, PaymentProvider.ESEWA, RETURN_URL, CALLBACK)
    assert err.value.code == "hold_expired"


def test_retry_after_failure_and_double_payment(lot, provider) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id)
    first = pay(booking)
    provider.result = ProviderResult("failed")
    verify(first.id)
    retry = pay(booking, PaymentProvider.KHALTI)  # a new attempt, new transaction id
    assert retry.transaction_uuid != first.transaction_uuid
    provider.result = completed()
    assert verify(retry.id).status == PaymentStatus.COMPLETED
    assert load(booking.id).paid_payment_id == retry.id
    # The first attempt turns out to have taken money too (driver paid in two tabs): it is recorded,
    # flagged for refund, and the booking keeps the payment that confirmed it.
    provider.result = completed()
    late = verify(first.id)
    assert late.status == PaymentStatus.COMPLETED and late.reconciliation == ReconciliationState.REFUND_REQUIRED
    assert load(booking.id).paid_payment_id == retry.id


def test_two_drivers_cannot_book_the_same_last_space(lot) -> None:
    parking_id, user_id, other_id = lot
    with SyncSessionLocal() as s:
        s.execute(update(ParkingLocation).where(ParkingLocation.id == parking_id).values(available_spaces=1))
        s.commit()
    results: dict[uuid.UUID, object] = {}
    barrier = threading.Barrier(2)

    def attempt(uid: uuid.UUID) -> None:
        barrier.wait()
        try:
            results[uid] = book(parking_id, uid)
        except AppError as exc:
            results[uid] = exc

    threads = [threading.Thread(target=attempt, args=(u,)) for u in (user_id, other_id)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    booked = [r for r in results.values() if isinstance(r, Booking)]
    refused = [r for r in results.values() if isinstance(r, AppError)]
    assert len(booked) == 1 and len(refused) == 1 and refused[0].code == "no_space"


def test_one_hold_per_driver_per_lot(lot) -> None:
    parking_id, user_id, _ = lot
    book(parking_id, user_id)
    with pytest.raises(AppError) as err:
        book(parking_id, user_id)
    assert err.value.code == "booking_pending"


def test_paid_but_confirmation_failed_is_reconciled(lot, provider, monkeypatch: pytest.MonkeyPatch) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id)
    payment = pay(booking)
    with SyncSessionLocal() as s:  # the driver paid after the hold ended, and confirming then crashes
        s.execute(update(Booking).where(Booking.id == booking.id).values(hold_expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        s.commit()

    def crash(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(service, "bookable_spaces", crash)
    provider.result = completed()
    payment = verify(payment.id)
    assert payment.status == PaymentStatus.COMPLETED
    assert payment.reconciliation == ReconciliationState.NEEDS_CONFIRMATION
    assert load(booking.id).status != BookingStatus.CONFIRMED

    monkeypatch.undo()  # the hiccup is over; the minute job retries
    with SyncSessionLocal() as s:
        counts = service.reconcile(s)
    assert counts["confirmed"] == 1
    booking = load(booking.id)
    assert booking.status == BookingStatus.CONFIRMED and booking.paid_payment_id == payment.id


def test_paid_after_hold_with_no_space_left_is_marked_for_refund(lot, provider) -> None:
    parking_id, user_id, other_id = lot
    with SyncSessionLocal() as s:
        s.execute(update(ParkingLocation).where(ParkingLocation.id == parking_id).values(available_spaces=1))
        s.commit()
    slow = book(parking_id, user_id)
    payment = pay(slow)
    with SyncSessionLocal() as s:
        s.execute(update(Booking).where(Booking.id == slow.id).values(hold_expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        s.commit()
    book(parking_id, other_id)  # someone else took the freed space
    provider.result = completed()
    payment = verify(payment.id)
    assert payment.reconciliation == ReconciliationState.REFUND_REQUIRED
    assert load(slow.id).status != BookingStatus.CONFIRMED


def test_extension_adds_hours_to_the_same_booking(lot, provider) -> None:
    parking_id, user_id, _ = lot
    booking = book(parking_id, user_id, hours=1)
    provider.result = completed(amount="50.00")
    verify(pay(booking).id)
    ends = load(booking.id).ends_at
    with SyncSessionLocal() as s:
        extension = service.create_extension(s, user_id, booking.id, 2)
        s.refresh(extension)
    assert extension.amount == Decimal("100.00")
    provider.result = completed(amount="100.00")
    verify(pay(extension).id)
    assert load(booking.id).ends_at == ends + timedelta(hours=2)  # type: ignore[operator]


def test_free_parking_is_not_bookable(lot) -> None:
    parking_id, user_id, _ = lot
    with SyncSessionLocal() as s:
        s.execute(update(ParkingLocation).where(ParkingLocation.id == parking_id).values(pricing_mode=PricingMode.FREE, price_per_hour=None))
        s.commit()
    with pytest.raises(AppError):
        book(parking_id, user_id)


def test_esewa_checkout_page_posts_signed_form(lot) -> None:
    parking_id, user_id, _ = lot
    payment = pay(book(parking_id, user_id))
    page = httpx.get(f"{BASE}/payments/{payment.id}/esewa/checkout", timeout=20)
    assert page.status_code == 200
    assert 'name="signature"' in page.text and "rc-epay.esewa.com.np" in page.text
    assert settings.esewa_secret_key not in page.text
    assert "form-action https://rc-epay.esewa.com.np" in page.headers["content-security-policy"]


# --------------------------------------------------------------------------- traffic-aware parking alerts

KEY = {"X-API-Key": settings.ingest_api_key}


@pytest.fixture
def camera():
    code = f"TB-{uuid.uuid4().hex[:6].upper()}"
    r = httpx.post(f"{BASE}/ingest/heartbeat", json={"camera_code": code, "latitude": 27.70, "longitude": 85.32}, headers=KEY, timeout=20)
    assert r.status_code == 200, r.text
    yield code
    with SyncSessionLocal() as s:
        cam = s.scalar(select(Camera).where(Camera.code == code))
        if cam:
            s.execute(delete(ParkedVehicle).where(ParkedVehicle.camera_id == cam.id))
            s.execute(delete(Camera).where(Camera.id == cam.id))
            s.commit()


def traffic(code: str, speed: float | None, calibrated: bool = True) -> None:
    r = httpx.post(
        f"{BASE}/ingest/telemetry",
        json={"camera_code": code, "vehicle_count": 3, "avg_speed_kmh": speed, "speed_calibrated": calibrated, "tracks": []},
        headers=KEY,
        timeout=20,
    )
    assert r.status_code == 200, r.text


def report(code: str, key: str, state: str, seq: int, box=(0.4, 0.4, 0.5, 0.5)) -> dict:  # type: ignore[no-untyped-def]
    body = {
        "camera_code": code,
        "bridge_id": "test",
        "vehicles": [
            {
                "vehicle_key": key,
                "track_id": 7,
                "state": state,
                "seq": seq,
                "changed_at": datetime.now(UTC).isoformat(),
                "vehicle_type": "car",
                "confidence": 0.9,
                "box": list(box),
                "stationary_seconds": 45,
                "evidence": {"reason": "traffic_passing", "passers": 3},
            }
        ],
    }
    r = httpx.post(f"{BASE}/ingest/parking-status", json=body, headers=KEY, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def vehicle(key: str, until=lambda v: True, timeout: float = 15) -> ParkedVehicle:  # type: ignore[no-untyped-def]
    deadline = time.time() + timeout
    while True:
        with SyncSessionLocal() as s:
            row = s.scalar(select(ParkedVehicle).where(ParkedVehicle.vehicle_key == key))
            if row is not None and until(row):
                return row
        if time.time() > deadline:
            return row  # type: ignore[return-value]
        time.sleep(0.5)


def alerts_for(code: str) -> int:
    with SyncSessionLocal() as s:
        return len(s.scalars(select(Alert.id).join(Camera, Camera.id == Alert.camera_id).where(Camera.code == code)).all())


def test_parked_in_normal_traffic_is_alerted_once(camera) -> None:
    traffic(camera, 34)  # clear road, measured now
    key = f"k-{uuid.uuid4().hex[:8]}"
    assert report(camera, key, "PARKED", 1)["applied"] == 1
    row = vehicle(key, lambda v: v.alert_id is not None)
    assert row.decision == EnforcementDecision.ALERTED and row.traffic_status == "NORMAL_FLOW"
    # The bridge repeats itself (retry, keepalive) and an old update arrives late: nothing new.
    again = report(camera, key, "PARKED", 1)
    assert again["keepalive"] == 1
    time.sleep(2)
    assert alerts_for(camera) == 1


def test_parked_in_traffic_jam_is_suppressed_then_alerted_when_traffic_clears(camera) -> None:
    traffic(camera, 4)  # congested
    key = f"k-{uuid.uuid4().hex[:8]}"
    report(camera, key, "PARKED", 1)
    row = vehicle(key, lambda v: v.decision != EnforcementDecision.PENDING)
    assert row.decision == EnforcementDecision.SUPPRESSED_TRAFFIC_JAM and row.alert_id is None
    assert alerts_for(camera) == 0
    traffic(camera, 33)  # the jam clears while the vehicle stays parked
    row = vehicle(key, lambda v: v.alert_id is not None)
    assert row.alert_id is not None and row.decision == EnforcementDecision.ALERTED
    assert alerts_for(camera) == 1


def test_unknown_traffic_suppresses(camera) -> None:
    traffic(camera, None, calibrated=False)  # uncalibrated camera: traffic never measured
    key = f"k-{uuid.uuid4().hex[:8]}"
    report(camera, key, "PARKED", 1)
    row = vehicle(key, lambda v: v.decision != EnforcementDecision.PENDING)
    assert row.decision == EnforcementDecision.SUPPRESSED_TRAFFIC_UNKNOWN
    assert alerts_for(camera) == 0


def test_not_parked_and_stale_updates_never_alert(camera) -> None:
    traffic(camera, 35)
    key = f"k-{uuid.uuid4().hex[:8]}"
    assert report(camera, key, "NOT_PARKED", 1)["ignored"] == 1  # never parked: nothing to track
    # Vehicle drove off (seq 2) before the PARKED change (seq 1) was delivered.
    report(camera, key, "PARKED", 1)
    report(camera, key, "NOT_PARKED", 2)
    assert report(camera, key, "PARKED", 1)["ignored"] == 1
    row = vehicle(key)
    assert row.state == "NOT_PARKED"


def test_restarted_bridge_does_not_double_alert(camera) -> None:
    traffic(camera, 35)
    first = f"k-{uuid.uuid4().hex[:8]}"
    report(camera, first, "PARKED", 1)
    vehicle(first, lambda v: v.alert_id is not None)
    second = f"k-{uuid.uuid4().hex[:8]}"  # same car, new key after a restart
    report(camera, second, "PARKED", 1, box=(0.405, 0.4, 0.505, 0.5))
    row = vehicle(second, lambda v: v.alert_id is not None)
    assert row.alert_id == vehicle(first).alert_id
    assert alerts_for(camera) == 1


def test_booking_api_as_a_signed_in_driver(lot) -> None:
    """The HTTP layer: book, view, refuse foreign return URLs, start eSewa, cancel."""
    from tests.test_flows import token_client

    try:
        _booking_api_checks(lot, token_client)
    finally:
        # This test signs in twice. Give those sign-ins back so the rest of the suite stays inside the
        # per-IP login limit, as conftest.py does at the start of the session.
        limits = Redis.from_url(settings.redis_url)
        keys = list(limits.scan_iter(match="LIMITS*", count=500))
        if keys:
            limits.delete(*keys)


def _booking_api_checks(lot, token_client) -> None:  # type: ignore[no-untyped-def]
    parking_id, _, _ = lot
    driver = token_client("sita.sharma@example.com")
    quote = driver.get(f"/parkings/{parking_id}/booking-quote", params={"hours": 3}).json()
    assert quote["amount"] == "150.00" and quote["bookable_spaces"] == 2
    created = driver.post("/bookings", json={"parking_id": str(parking_id), "hours": 3})
    assert created.status_code == 201, created.text
    booking = created.json()
    assert booking["display_status"] == "awaiting_payment" and booking["can_pay"] and booking["amount"] == "150.00"
    assert driver.get(f"/bookings/{booking['id']}").json()["reference"] == booking["reference"]
    evil = driver.post(f"/bookings/{booking['id']}/payments", json={"provider": "esewa", "return_url": "https://evil.example/x"})
    assert evil.status_code == 422
    checkout = driver.post(
        f"/bookings/{booking['id']}/payments",
        json={"provider": "esewa", "return_url": f"http://localhost:3000/bookings/{booking['id']}"},
    )
    assert checkout.status_code == 201, checkout.text
    assert checkout.json()["checkout_url"].endswith("/esewa/checkout")
    assert any(b["id"] == booking["id"] for b in driver.get("/bookings", params={"scope": "active"}).json()["items"])
    cancelled = driver.post(f"/bookings/{booking['id']}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["display_status"] == "cancelled"
    # Other people's bookings do not exist as far as this driver is concerned.
    officer = token_client("TP-2841")
    assert officer.get(f"/bookings/{booking['id']}").status_code == 404
