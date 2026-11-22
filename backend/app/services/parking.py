from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.models.enums import (
    AvailabilityStatus,
    AvailableDays,
    OccupancySource,
    ParkingCategory,
    ParkingStatus,
    ParkingType,
)
from app.models.parking import ParkingLocation
from app.schemas.parking import ParkingDetail, ParkingSummary

_TZ = ZoneInfo(settings.timezone)
_DAYS = {
    AvailableDays.EVERY_DAY: {0, 1, 2, 3, 4, 5, 6},
    AvailableDays.WEEKDAYS: {0, 1, 2, 3, 4},
    AvailableDays.MON_SAT: {0, 1, 2, 3, 4, 5},
    AvailableDays.WEEKENDS: {5, 6},
}


def is_open_now(parking: ParkingLocation, now: datetime | None = None) -> bool:
    if parking.status in (ParkingStatus.CLOSED, ParkingStatus.SUSPENDED):
        return False
    local = (now or datetime.now(_TZ)).astimezone(_TZ)
    if local.weekday() not in _DAYS[parking.available_days]:
        return False
    current: time = local.time().replace(tzinfo=None)
    if parking.opens_at < parking.closes_at:
        return parking.opens_at <= current < parking.closes_at
    return current >= parking.opens_at or current < parking.closes_at  # overnight hours


def closes_at_after(parking: ParkingLocation, now: datetime) -> datetime | None:
    """When the facility next closes, for one that is open at `now`. None for round-the-clock parking."""
    if parking.opens_at == parking.closes_at:
        return None
    local = now.astimezone(_TZ)
    close_today = datetime.combine(local.date(), parking.closes_at, _TZ)
    if parking.opens_at < parking.closes_at or local.time().replace(tzinfo=None) < parking.closes_at:
        return close_today
    return close_today + timedelta(days=1)  # overnight hours, after midnight's opening


def marker_tone(parking: ParkingLocation, open_now: bool) -> str:
    """Map colours: green = available private, blue = government, red = unavailable."""
    if not open_now or parking.status != ParkingStatus.OPEN or parking.available_spaces <= 0:
        return "red"
    return "blue" if parking.category == ParkingCategory.GOVERNMENT else "green"


def to_summary(parking: ParkingLocation, distance_m: float | None = None) -> ParkingSummary:
    open_now = is_open_now(parking)
    status = availability_status(parking, open_now)
    return ParkingSummary.model_validate(
        {
            **_columns(parking),
            "available_spaces": clamp_available(parking.capacity, parking.available_spaces),
            "occupied_spaces": occupied_spaces(parking),
            "availability_status": status,
            "availability_label": AVAILABILITY_LABELS[status],
            "parking_type_label": PARKING_TYPE_LABELS[parking.parking_type],
            "distance_m": round(distance_m, 1) if distance_m is not None else None,
            "marker_tone": marker_tone(parking, open_now),
            "is_open_now": open_now,
        }
    )


def to_detail(parking: ParkingLocation, distance_m: float | None = None) -> ParkingDetail:
    summary = to_summary(parking, distance_m)
    return ParkingDetail.model_validate(
        {
            **summary.model_dump(),
            "managed_by": parking.managed_by,
            "contact_phone": parking.contact_phone,
            "land_size_sqm": parking.land_size_sqm,
            "is_owner_verified": parking.category == ParkingCategory.GOVERNMENT or parking.application_id is not None,
            "occupancy_source": parking.occupancy_source,
            "occupancy_updated_at": parking.occupancy_updated_at,
            "created_at": parking.created_at,
        }
    )


def _columns(parking: ParkingLocation) -> dict[str, object]:
    derived = {
        "distance_m",
        "marker_tone",
        "is_open_now",
        "occupied_spaces",
        "availability_status",
        "availability_label",
        "parking_type_label",
    }
    fields = ParkingSummary.model_fields.keys() - derived
    return {name: getattr(parking, name) for name in fields}


# --------------------------------------------------------------------------- availability

PARKING_TYPE_LABELS = {
    ParkingType.OPEN_AIR: "Open-air lot",
    ParkingType.COVERED: "Covered parking",
    ParkingType.BASEMENT: "Basement parking",
    ParkingType.ROOFTOP: "Rooftop parking",
    ParkingType.STREET: "Street parking",
}

AVAILABILITY_LABELS = {
    AvailabilityStatus.AVAILABLE: "Available",
    AvailabilityStatus.PARTIAL: "Partially available",
    AvailabilityStatus.FULL: "Full",
    AvailabilityStatus.CLOSED: "Closed",
}


def occupied_spaces(parking: ParkingLocation) -> int:
    """Occupancy is always derived from capacity and free spaces, so the two can never disagree."""
    return max(0, parking.capacity - clamp_available(parking.capacity, parking.available_spaces))


def clamp_available(capacity: int, available: int) -> int:
    return max(0, min(int(available), max(0, int(capacity))))


def availability_status(parking: ParkingLocation, open_now: bool) -> AvailabilityStatus:
    if not open_now:
        return AvailabilityStatus.CLOSED
    free = clamp_available(parking.capacity, parking.available_spaces)
    if parking.status == ParkingStatus.FULL or free <= 0:
        return AvailabilityStatus.FULL
    if parking.capacity > 0 and free / parking.capacity <= settings.parking_partial_threshold:
        return AvailabilityStatus.PARTIAL
    return AvailabilityStatus.AVAILABLE


def set_occupancy(parking: ParkingLocation, occupied: int, source: OccupancySource = OccupancySource.MANUAL) -> bool:
    """Single place that changes how many spaces are taken. Returns True when anything changed.

    Available spaces = capacity - occupied, kept within 0..capacity.
    """
    free = clamp_available(parking.capacity, parking.capacity - max(0, occupied))
    changed = free != parking.available_spaces
    if changed or source == OccupancySource.MANUAL or parking.occupancy_source != source:
        parking.occupancy_source = source
        parking.occupancy_updated_at = datetime.now(UTC)
    parking.available_spaces = free
    # Keep the operator-visible status in step; CLOSED and SUSPENDED are decisions people made, so they stay.
    if parking.status == ParkingStatus.OPEN and free == 0:
        parking.status, changed = ParkingStatus.FULL, True
    elif parking.status == ParkingStatus.FULL and free > 0:
        parking.status, changed = ParkingStatus.OPEN, True
    return changed


def realtime_payload(parking: ParkingLocation) -> dict[str, object]:
    open_now = is_open_now(parking)
    status = availability_status(parking, open_now)
    return {
        "id": str(parking.id),
        "capacity": parking.capacity,
        "available_spaces": clamp_available(parking.capacity, parking.available_spaces),
        "occupied_spaces": occupied_spaces(parking),
        "status": parking.status.value,
        "availability_status": status.value,
        "availability_label": AVAILABILITY_LABELS[status],
        "marker_tone": marker_tone(parking, open_now),
        "is_open_now": open_now,
        "occupancy_source": parking.occupancy_source.value if parking.occupancy_source else None,
        "occupancy_updated_at": parking.occupancy_updated_at.isoformat() if parking.occupancy_updated_at else None,
    }
