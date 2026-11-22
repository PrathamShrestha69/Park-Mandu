"""Turns what an AI camera sees into a parking facility's occupancy, without double counting.

The tracker can report one real vehicle more than once (it loses a car behind another and starts a new
track, or two tracks overlap on the same car). Three guards keep availability honest:

1. repeated track ids in one report count once,
2. tracks whose boxes overlap heavily are the same vehicle,
3. a new figure is only applied after it has been reported several times in a row, so a flicker never
   changes availability.

A manual correction (owner or admin) puts the facility on hold: the camera's view at that moment becomes
the baseline, and automatic updates resume only once what the camera sees changes.
"""

import uuid
from collections.abc import Sequence

from app.core.config import settings
from app.core.redis import redis_client
from app.models.enums import OccupancySource, ParkingStatus
from app.models.monitoring import Camera
from app.models.parking import ParkingLocation
from app.schemas.monitoring import TrackedVehicle
from app.services.parking import realtime_payload, set_occupancy

SAME_VEHICLE_IOU = 0.6
# Only vehicles that have stopped for good take a space; cars driving past do not.
OCCUPYING_STATUS = "parked"


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def distinct_vehicles(tracks: Sequence[TrackedVehicle], *, only_parked: bool) -> int:
    """Number of distinct vehicles in one tracking report, each real vehicle counted once."""
    unique: dict[int, TrackedVehicle] = {}
    for track in tracks:
        if only_parked and track.status != OCCUPYING_STATUS:
            continue
        kept = unique.get(track.track_id)
        if kept is None or track.confidence > kept.confidence:
            unique[track.track_id] = track
    distinct: list[TrackedVehicle] = []
    for track in sorted(unique.values(), key=lambda t: -t.confidence):
        if all(_iou(track.box, other.box) < SAME_VEHICLE_IOU for other in distinct):
            distinct.append(track)
    return len(distinct)


def parked_vehicle_count(tracks: Sequence[TrackedVehicle]) -> int:
    """Police cameras: only vehicles that have stopped for good."""
    return distinct_vehicles(tracks, only_parked=True)


def vehicle_count(tracks: Sequence[TrackedVehicle]) -> int:
    """Owner parking cameras: every vehicle the camera sees, whether moving or standing still."""
    return distinct_vehicles(tracks, only_parked=False)


# How long a manual correction can hold back the camera when the camera view never changes.
MANUAL_HOLD_SECONDS = 6 * 3600


def _pending_key(parking_id: uuid.UUID, camera_id: uuid.UUID) -> str:
    return f"parking:occupancy:{parking_id}:{camera_id}"


def _hold_key(parking_id: uuid.UUID) -> str:
    return f"parking:occupancy:hold:{parking_id}"


async def hold_after_manual_correction(parking_id: uuid.UUID) -> None:
    """Keeps a hand-entered figure until the camera actually sees something different."""
    # Empty value: the next camera report sets the baseline.
    await redis_client.set(_hold_key(parking_id), "", ex=MANUAL_HOLD_SECONDS)


async def is_on_manual_hold(parking_id: uuid.UUID) -> bool:
    return bool(await redis_client.exists(_hold_key(parking_id)))


async def clear_hold(parking_id: uuid.UUID) -> None:
    await redis_client.delete(_hold_key(parking_id))


async def _held_back(parking_id: uuid.UUID, observed: int) -> bool:
    key = _hold_key(parking_id)
    baseline = await redis_client.get(key)
    if baseline is None:
        return False
    if baseline == "":
        await redis_client.set(key, str(observed), keepttl=True)
        return True
    if baseline == str(observed):
        return True
    await redis_client.delete(key)  # the scene changed: the camera is in charge again
    return False


async def apply_camera_report(
    db_parking: ParkingLocation | None, camera: Camera, tracks: Sequence[TrackedVehicle]
) -> dict[str, object] | None:
    """Updates the facility this camera watches. Returns the realtime payload when availability changed."""
    parking = db_parking
    if parking is None or parking.status in (ParkingStatus.CLOSED, ParkingStatus.SUSPENDED):
        return None
    # An owner's camera only counts what it sees; it does not judge whether a vehicle is parked.
    count = vehicle_count(tracks) if camera.owner_id is not None else parked_vehicle_count(tracks)
    observed = min(count, parking.capacity)
    if await _held_back(parking.id, observed):
        return None
    key = _pending_key(parking.id, camera.id)
    previous = await redis_client.get(key)
    value, _, streak = (previous or "").partition(":")
    streak_count = int(streak) + 1 if value == str(observed) and streak.isdigit() else 1
    await redis_client.set(key, f"{observed}:{streak_count}", ex=120)
    if streak_count < settings.occupancy_confirmations:
        return None
    if not set_occupancy(parking, observed, OccupancySource.CAMERA):
        return None
    return realtime_payload(parking)
