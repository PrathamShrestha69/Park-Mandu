from datetime import datetime, time
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.models.enums import AvailableDays, ParkingCategory, ParkingStatus
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


def marker_tone(parking: ParkingLocation, open_now: bool) -> str:
    """Map colours: green = available private, blue = government, red = unavailable."""
    if not open_now or parking.status != ParkingStatus.OPEN or parking.available_spaces <= 0:
        return "red"
    return "blue" if parking.category == ParkingCategory.GOVERNMENT else "green"


def to_summary(parking: ParkingLocation, distance_m: float | None = None) -> ParkingSummary:
    open_now = is_open_now(parking)
    return ParkingSummary.model_validate(
        {
            **_columns(parking),
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
            "created_at": parking.created_at,
        }
    )


def _columns(parking: ParkingLocation) -> dict[str, object]:
    fields = ParkingSummary.model_fields.keys() - {"distance_m", "marker_tone", "is_open_now"}
    return {name: getattr(parking, name) for name in fields}
