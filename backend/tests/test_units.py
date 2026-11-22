"""Database-free tests for dispatch selection, availability and occupancy de-duplication."""

import uuid
from datetime import time
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import configure_mappers

from app.models.enums import AvailabilityStatus, OccupancySource, ParkingStatus, VehicleType
from app.schemas.application import PropertyStep
from app.schemas.monitoring import TrackedVehicle
from app.schemas.parking import OwnerCameraConnect
from app.schemas.suggestion import SuggestionCreate
from app.services.dispatch import Candidate, choose_nearest, haversine_m
from app.services.occupancy import parked_vehicle_count, vehicle_count
from app.services.parking import availability_status, occupied_spaces, set_occupancy


def test_mappers_configure() -> None:
    import app.models  # noqa: F401

    configure_mappers()


# --------------------------------------------------------------------------- dispatch


def _c(distance: float) -> Candidate:
    return Candidate(uuid.uuid4(), distance)


def test_nearest_officer_inside_radius_wins() -> None:
    near, far = _c(420), _c(870)
    assert choose_nearest([far, near], 1000) == near


def test_officers_outside_radius_are_never_chosen() -> None:
    assert choose_nearest([_c(1001), _c(2500)], 1000) is None


def test_declined_officer_is_skipped_for_next_nearest() -> None:
    first, second = _c(100), _c(300)
    assert choose_nearest([first, second], 1000, {first.officer_id}) == second


def test_nobody_available() -> None:
    assert choose_nearest([], 1000) is None


def test_haversine_one_km_in_kathmandu() -> None:
    # ~0.009 degrees of latitude is about 1 km.
    assert 990 < haversine_m(27.7000, 85.3200, 27.7090, 85.3200) < 1010


# --------------------------------------------------------------------------- availability


def _parking(capacity: int, available: int, status: ParkingStatus = ParkingStatus.OPEN) -> SimpleNamespace:
    return SimpleNamespace(
        capacity=capacity, available_spaces=available, status=status, occupancy_source=None, occupancy_updated_at=None
    )


def test_availability_states() -> None:
    assert availability_status(_parking(40, 30), True) == AvailabilityStatus.AVAILABLE
    assert availability_status(_parking(40, 10), True) == AvailabilityStatus.PARTIAL
    assert availability_status(_parking(40, 0), True) == AvailabilityStatus.FULL
    assert availability_status(_parking(40, 30), False) == AvailabilityStatus.CLOSED


def test_occupancy_is_clamped_to_capacity() -> None:
    p = _parking(20, 50)  # bad stored data never shows more free spaces than exist
    assert occupied_spaces(p) == 0  # type: ignore[arg-type]
    set_occupancy(p, 25)  # type: ignore[arg-type]
    assert p.available_spaces == 0 and p.status == ParkingStatus.FULL
    set_occupancy(p, 5)  # type: ignore[arg-type]
    assert p.available_spaces == 15 and p.status == ParkingStatus.OPEN


def test_closed_parking_status_is_not_overridden() -> None:
    p = _parking(10, 10, ParkingStatus.CLOSED)
    set_occupancy(p, 10)  # type: ignore[arg-type]
    assert p.status == ParkingStatus.CLOSED


# --------------------------------------------------------------------------- occupancy de-duplication


def _track(track_id: int, box: tuple[float, float, float, float], status: str = "parked") -> TrackedVehicle:
    return TrackedVehicle(track_id=track_id, vehicle_type="car", status=status, confidence=0.9, box=box)


def test_repeated_track_ids_count_once() -> None:
    box = (0.1, 0.1, 0.2, 0.2)
    assert parked_vehicle_count([_track(1, box), _track(1, box)]) == 1


def test_overlapping_tracks_are_one_vehicle() -> None:
    assert parked_vehicle_count([_track(1, (0.1, 0.1, 0.3, 0.3)), _track(2, (0.11, 0.11, 0.31, 0.31))]) == 1


def test_separate_vehicles_and_moving_ones() -> None:
    tracks = [
        _track(1, (0.1, 0.1, 0.2, 0.2)),
        _track(2, (0.5, 0.5, 0.6, 0.6)),
        _track(3, (0.7, 0.7, 0.8, 0.8), status="moving"),
    ]
    assert parked_vehicle_count(tracks) == 2


# --------------------------------------------------------------------------- suggestions


def test_suggestion_validation() -> None:
    import pytest
    from pydantic import ValidationError

    assert SuggestionCreate(message="  Please add more   bike parking near Ratna Park  ").message.startswith(
        "Please add"
    )
    for bad in ["", "too short", "1234567890123", "aaaaaaaaaaaaaaa", "see http://a.com and http://b.com please now"]:
        with pytest.raises(ValidationError):
            SuggestionCreate(message=bad)


# --------------------------------------------------------------------------- vehicle types and owner cameras


def test_occupancy_records_its_source() -> None:
    p = _parking(30, 30)
    set_occupancy(p, 12, OccupancySource.CAMERA)  # type: ignore[arg-type]
    assert p.available_spaces == 18  # available = capacity - occupied
    assert p.occupancy_source == OccupancySource.CAMERA and p.occupancy_updated_at is not None
    # A manual confirmation of the same figure still counts as the latest source.
    set_occupancy(p, 12)  # type: ignore[arg-type]
    assert p.occupancy_source == OccupancySource.MANUAL


def _property(**overrides: object) -> PropertyStep:
    data: dict[str, object] = {
        "property_name": "Sharma Parking",
        "capacity": 20,
        "parking_type": "open_air",
        "vehicle_types": ["bike", "car", "bike"],
        "opens_at": time(7),
        "closes_at": time(21),
        "available_days": "every_day",
        "pricing_mode": "free",
    }
    return PropertyStep.model_validate({**data, **overrides})


def test_vehicle_types_are_deduplicated_in_order() -> None:
    assert _property().vehicle_types == [VehicleType.CAR, VehicleType.BIKE]


def test_vehicle_types_are_required() -> None:
    with pytest.raises(ValidationError):
        _property(vehicle_types=[])
    with pytest.raises(ValidationError):
        _property(vehicle_types=["truck"])


def test_owner_camera_needs_a_stream_address() -> None:
    camera = OwnerCameraConnect(name="Gate", source_url=" rtsp://10.0.0.5:554/s1 ")
    assert camera.source_url == "rtsp://10.0.0.5:554/s1"
    assert OwnerCameraConnect(name="Gate", source_url="0").source_url == "0"  # local camera index
    with pytest.raises(ValidationError):
        OwnerCameraConnect(name="Gate", source_url="not a url")


def test_owner_cameras_count_every_vehicle_not_just_parked() -> None:
    tracks = [
        _track(1, (0.0, 0.0, 0.2, 0.2), "moving"),
        _track(2, (0.5, 0.5, 0.7, 0.7), "stopped"),
        _track(3, (0.8, 0.1, 0.95, 0.3), "parked"),
        _track(3, (0.8, 0.1, 0.95, 0.3), "parked"),  # same track twice is one vehicle
    ]
    assert vehicle_count(tracks) == 3
    assert parked_vehicle_count(tracks) == 1  # police behaviour unchanged
