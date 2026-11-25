"""Unit tests for traffic-aware parking enforcement, eSewa/Khalti gateways and routing. No database needed."""

import base64
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest

from app.core.errors import AppError
from app.models.enums import CameraStatus, EnforcementDecision, ParkingState, TrafficLevel, TrafficStatus
from app.services import parking_enforcement
from app.services.payments import gateways, service
from app.services.payments.gateways import Esewa, GatewayError, Khalti, SignatureError
from app.services.routing import RoutingError, instruction, parse
from app.services.traffic import measured_level, traffic_status

NOW = datetime(2026, 11, 22, 10, 0, tzinfo=UTC)


# --------------------------------------------------------------------------- traffic status


def _camera(**overrides: object) -> SimpleNamespace:
    base = {
        "status": CameraStatus.LIVE,
        "traffic_level": TrafficLevel.CLEAR,
        "traffic_updated_at": NOW - timedelta(seconds=10),
        "owner_id": None,
        "parking_id": None,
    }
    return SimpleNamespace(**{**base, **overrides})


def test_traffic_status_maps_existing_levels() -> None:
    assert traffic_status(_camera(traffic_level=TrafficLevel.CLEAR), NOW) == TrafficStatus.NORMAL_FLOW
    assert traffic_status(_camera(traffic_level=TrafficLevel.MODERATE), NOW) == TrafficStatus.NORMAL_FLOW
    assert traffic_status(_camera(traffic_level=TrafficLevel.SLOW), NOW) == TrafficStatus.NORMAL_FLOW  # slow is not a jam
    assert traffic_status(_camera(traffic_level=TrafficLevel.CONGESTED), NOW) == TrafficStatus.TRAFFIC_JAM


def test_traffic_unknown_when_missing_outdated_or_camera_down() -> None:
    assert traffic_status(_camera(traffic_updated_at=None), NOW) == TrafficStatus.UNKNOWN
    assert traffic_status(_camera(traffic_updated_at=NOW - timedelta(minutes=10)), NOW) == TrafficStatus.UNKNOWN
    assert traffic_status(_camera(status=CameraStatus.OFFLINE), NOW) == TrafficStatus.UNKNOWN


def test_measured_level_reuses_speed_bands() -> None:
    assert measured_level(35, calibrated=True, flowing_vehicles=4) == TrafficLevel.CLEAR
    assert measured_level(3, calibrated=True, flowing_vehicles=4) == TrafficLevel.CONGESTED
    assert measured_level(None, calibrated=False, flowing_vehicles=0) is None  # uncalibrated: no measurement
    assert measured_level(None, calibrated=True, flowing_vehicles=0) == TrafficLevel.CLEAR  # empty road
    assert measured_level(None, calibrated=True, flowing_vehicles=3) is None  # vehicles, no speed yet


# --------------------------------------------------------------------------- enforcement table


def _vehicle(**overrides: object) -> SimpleNamespace:
    base = {
        "state": ParkingState.PARKED,
        "alert_id": None,
        "last_seen_at": NOW - timedelta(seconds=5),
        "confidence": 0.9,
        "evidence": {"reason": "standing_alone"},
    }
    return SimpleNamespace(**{**base, **overrides})


def _decide(vehicle: SimpleNamespace, camera: SimpleNamespace) -> EnforcementDecision:
    from unittest.mock import patch

    with patch.object(parking_enforcement, "datetime"):
        return parking_enforcement.decide(vehicle, camera, NOW)[0]  # type: ignore[arg-type]


def test_not_parked_never_alerts_in_any_traffic() -> None:
    for level in TrafficLevel:
        assert _decide(_vehicle(state=ParkingState.NOT_PARKED), _camera(traffic_level=level)) == EnforcementDecision.NOT_PARKED


def test_parked_in_normal_flow_alerts() -> None:
    assert _decide(_vehicle(), _camera(traffic_level=TrafficLevel.CLEAR)) == EnforcementDecision.ALERTED


def test_parked_in_traffic_jam_is_suppressed() -> None:
    decision = _decide(_vehicle(), _camera(traffic_level=TrafficLevel.CONGESTED))
    assert decision == EnforcementDecision.SUPPRESSED_TRAFFIC_JAM


def test_parked_with_traffic_passing_is_alerted_even_in_a_jam() -> None:
    vehicle = _vehicle(evidence={"reason": "traffic_passing", "passers": 3})
    assert _decide(vehicle, _camera(traffic_level=TrafficLevel.CONGESTED)) == EnforcementDecision.ALERTED


def test_parked_with_unknown_or_old_traffic_is_alerted() -> None:
    # Only a measured jam holds an alert back; traffic that is unknown or old does not.
    assert _decide(_vehicle(), _camera(traffic_updated_at=None)) == EnforcementDecision.ALERTED
    old = _camera(traffic_updated_at=NOW - timedelta(minutes=5))
    assert _decide(_vehicle(), old) == EnforcementDecision.ALERTED
    assert _decide(_vehicle(), _camera(traffic_level=TrafficLevel.SLOW)) == EnforcementDecision.ALERTED


def test_jam_then_normal_flow_alerts_on_reassessment() -> None:
    vehicle = _vehicle()
    assert _decide(vehicle, _camera(traffic_level=TrafficLevel.CONGESTED)) == EnforcementDecision.SUPPRESSED_TRAFFIC_JAM
    assert _decide(vehicle, _camera(traffic_level=TrafficLevel.MODERATE)) == EnforcementDecision.ALERTED


def test_illegal_parking_rules() -> None:
    assert _decide(_vehicle(alert_id="a1"), _camera()) == EnforcementDecision.ALERTED  # already alerted: no second
    assert _decide(_vehicle(confidence=0.4), _camera()) == EnforcementDecision.LOW_CONFIDENCE
    assert _decide(_vehicle(), _camera(owner_id="owner")) == EnforcementDecision.LEGAL_PARKING
    assert _decide(_vehicle(), _camera(parking_id="facility")) == EnforcementDecision.LEGAL_PARKING
    assert _decide(_vehicle(), _camera(status=CameraStatus.MAINTENANCE)) == EnforcementDecision.CAMERA_UNAVAILABLE
    stale = _vehicle(last_seen_at=NOW - timedelta(minutes=5))
    assert _decide(stale, _camera()) == EnforcementDecision.NOT_OBSERVED


# --------------------------------------------------------------------------- eSewa

SANDBOX_SECRET = "8gBm/:&EnhH.1/q"


def _esewa(status_url: str = "https://esewa.test/status/") -> Esewa:
    return Esewa(product_code="EPAYTEST", secret_key=SANDBOX_SECRET, form_url="https://esewa.test/form", status_url=status_url)


def _mock(monkeypatch: pytest.MonkeyPatch, handler) -> list[httpx.Request]:  # type: ignore[no-untyped-def]
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(gateways, "_client", lambda: httpx.Client(transport=httpx.MockTransport(wrapped)))
    return seen


def test_esewa_form_is_signed_over_amount_uuid_and_product() -> None:
    fields = _esewa().form_fields(
        transaction_uuid="BK-7100-ab", amount=Decimal("150.00"), success_url="https://a/s", failure_url="https://a/f"
    )
    assert fields["total_amount"] == "150"
    assert fields["signed_field_names"] == "total_amount,transaction_uuid,product_code"
    expected = _esewa().sign("total_amount=150,transaction_uuid=BK-7100-ab,product_code=EPAYTEST")
    assert fields["signature"] == expected
    assert "secret" not in json.dumps(fields).lower() and SANDBOX_SECRET not in json.dumps(fields)


def _callback(gateway: Esewa, **overrides: object) -> str:
    body = {
        "transaction_code": "000AWEO",
        "status": "COMPLETE",
        "total_amount": "1,000.0",
        "transaction_uuid": "BK-7100-ab",
        "product_code": "EPAYTEST",
        "signed_field_names": "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names",
    }
    body.update(overrides)  # type: ignore[arg-type]
    names = str(body["signed_field_names"]).split(",")
    body["signature"] = gateway.sign(",".join(f"{n}={body[n]}" for n in names))
    if "tamper" in overrides:
        body["total_amount"] = "1.0"
    return base64.b64encode(json.dumps(body).encode()).decode()


def test_esewa_callback_signature_is_checked() -> None:
    gateway = _esewa()
    assert gateway.decode_callback(_callback(gateway), transaction_uuid="BK-7100-ab")["status"] == "COMPLETE"
    with pytest.raises(SignatureError):
        gateway.decode_callback(_callback(gateway, tamper=True), transaction_uuid="BK-7100-ab")
    with pytest.raises(SignatureError):  # a genuine callback for another payment
        gateway.decode_callback(_callback(gateway), transaction_uuid="BK-9999-zz")
    with pytest.raises(SignatureError):
        gateway.decode_callback("not-base64!!", transaction_uuid="BK-7100-ab")


def test_esewa_status_mapping(monkeypatch: pytest.MonkeyPatch) -> None:
    answers = iter(
        [
            {"status": "COMPLETE", "total_amount": 150.0, "transaction_uuid": "u", "ref_id": "R1"},
            {"status": "PENDING", "total_amount": 150.0, "transaction_uuid": "u"},
            {"status": "CANCELED", "transaction_uuid": "u"},
            {"status": "NOT_FOUND"},
        ]
    )
    seen = _mock(monkeypatch, lambda r: httpx.Response(200, json=next(answers)))
    gateway = _esewa()
    first = gateway.check_status(transaction_uuid="u", amount=Decimal(150))
    assert (first.state, first.amount, first.transaction_id) == ("completed", Decimal("150.00"), "R1")
    assert seen[0].url.params["total_amount"] == "150" and seen[0].url.params["product_code"] == "EPAYTEST"
    assert [gateway.check_status(transaction_uuid="u", amount=Decimal(150)).state for _ in range(3)] == [
        "pending",
        "cancelled",
        "not_found",
    ]


def test_esewa_unreachable_raises_gateway_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    _mock(monkeypatch, boom)
    with pytest.raises(GatewayError):
        _esewa().check_status(transaction_uuid="u", amount=Decimal(150))


# --------------------------------------------------------------------------- Khalti


def test_khalti_initiate_sends_paisa_and_secret_only_in_header(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _mock(
        monkeypatch,
        lambda r: httpx.Response(200, json={"pidx": "P1", "payment_url": "https://pay.khalti.test/P1", "expires_at": None}),
    )
    session = Khalti(secret_key="test-secret", base_url="https://khalti.test/api/v2").initiate(
        amount=Decimal("150.00"),
        purchase_order_id="BK-7100-ab",
        purchase_order_name="Parking",
        return_url="https://api/r",
        website_url="https://web",
        customer={"name": "Sita"},
    )
    assert session.pidx == "P1"
    body = json.loads(seen[0].content)
    assert body["amount"] == 15000
    assert seen[0].headers["Authorization"] == "Key test-secret"
    assert "test-secret" not in seen[0].content.decode()


@pytest.mark.parametrize(
    ("status", "expected"),
    [("Completed", "completed"), ("Pending", "pending"), ("User canceled", "cancelled"), ("Expired", "expired"), ("Refunded", "refunded")],
)
def test_khalti_lookup_mapping(monkeypatch: pytest.MonkeyPatch, status: str, expected: str) -> None:
    _mock(monkeypatch, lambda r: httpx.Response(200, json={"pidx": "P1", "status": status, "total_amount": 15000, "transaction_id": "T1"}))
    result = Khalti(secret_key="k", base_url="https://khalti.test/api/v2").lookup("P1")
    assert result.state == expected and result.amount == Decimal("150.00")


def test_khalti_rejected_key_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock(monkeypatch, lambda r: httpx.Response(401, json={"detail": "Invalid token."}))
    with pytest.raises(GatewayError) as err:
        Khalti(secret_key="bad", base_url="https://khalti.test/api/v2").lookup("P1")
    assert err.value.code == "provider_auth_failed"


# --------------------------------------------------------------------------- bookings: pure parts


def test_return_url_allow_list() -> None:
    assert service.validate_return_url("http://localhost:3000/bookings/1")
    assert service.validate_return_url("parkmandu://booking/1")
    assert service.validate_return_url("exp://192.168.1.5:8081/--/booking/1")
    for bad in ("https://evil.example/steal", "javascript:alert(1)", "//evil.example"):
        with pytest.raises(AppError):
            service.validate_return_url(bad)


def test_price_uses_the_facilitys_hourly_rate() -> None:
    from app.models.enums import PricingMode

    hourly = SimpleNamespace(pricing_mode=PricingMode.HOURLY, price_per_hour=Decimal("35.00"))
    assert service.price(hourly, 3) == Decimal("105.00")  # type: ignore[arg-type]
    free = SimpleNamespace(pricing_mode=PricingMode.FREE, price_per_hour=None)
    with pytest.raises(AppError):
        service.price(free, 1)  # type: ignore[arg-type]


def test_amount_formatting_and_paisa() -> None:
    assert gateways.amount_text(Decimal("100")) == "100"
    assert gateways.amount_text(Decimal("99.5")) == "99.50"
    assert gateways.to_paisa(Decimal("150.25")) == 15025
    assert gateways.parse_amount("1,000.0") == Decimal("1000.00")


# --------------------------------------------------------------------------- routing


OSRM_OK = {
    "code": "Ok",
    "routes": [
        {
            "distance": 1820.4,
            "duration": 312.9,
            "geometry": {"type": "LineString", "coordinates": [[85.32, 27.70], [85.321, 27.701], [85.324, 27.705]]},
            "legs": [
                {
                    "steps": [
                        {"distance": 300, "duration": 60, "name": "Kantipath", "maneuver": {"type": "depart", "bearing_after": 2, "location": [85.32, 27.70]}},
                        {"distance": 1500, "duration": 250, "name": "Durbar Marg", "maneuver": {"type": "turn", "modifier": "left", "location": [85.321, 27.701]}},
                        {"distance": 0, "duration": 0, "name": "", "maneuver": {"type": "arrive", "location": [85.324, 27.705]}},
                    ]
                }
            ],
        }
    ],
}


def test_route_is_parsed_with_distance_time_and_steps() -> None:
    route = parse(OSRM_OK)
    assert route.distance_m == 1820.4 and route.duration_s == 312.9
    assert route.geometry[0] == (85.32, 27.70) and len(route.geometry) == 3
    assert [s.instruction for s in route.steps] == [
        "Head north onto Kantipath",
        "Turn left onto Durbar Marg",
        "You have arrived at the parking",
    ]


def test_route_failures_are_clear_errors() -> None:
    with pytest.raises(RoutingError) as no_route:
        parse({"code": "NoRoute", "routes": []})
    assert no_route.value.status_code == 404
    with pytest.raises(RoutingError) as broken:
        parse({"code": "InvalidQuery"})
    assert broken.value.status_code == 503


def test_instructions_cover_roundabouts_and_uturns() -> None:
    assert instruction({"name": "Ring Road", "maneuver": {"type": "roundabout", "exit": 2}}) == "At the roundabout, take exit 2 onto Ring Road"
    assert instruction({"name": "", "maneuver": {"type": "turn", "modifier": "uturn"}}) == "Make a U-turn"
