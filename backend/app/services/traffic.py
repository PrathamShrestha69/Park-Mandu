"""Traffic conditions and live vehicle tracking shared by the API, the worker and the demo simulator."""

import json
import uuid
from datetime import datetime, timedelta
from typing import Any

from app.core.config import settings
from app.models.enums import CameraStatus, TrafficLevel, TrafficStatus

# Average road speed (km/h) that belongs to each traffic level: [lower, upper). The demo simulator
# draws speeds from these bands and real detector measurements are classified with the same bands,
# so simulated and AI cameras always agree on what "slow" means.
TRAFFIC_SPEED_BANDS: dict[TrafficLevel, tuple[int, int]] = {
    TrafficLevel.CLEAR: (28, 42),
    TrafficLevel.MODERATE: (18, 28),
    TrafficLevel.SLOW: (8, 18),
    TrafficLevel.CONGESTED: (2, 8),
}

# A detector sends tracking every few seconds; after this long without an update it is no longer live.
TRACKING_TTL_SECONDS = 15


def level_for_speed(avg_speed_kmh: float) -> TrafficLevel:
    """Traffic level for a measured average speed, using the lower bound of each band."""
    for level in (TrafficLevel.CLEAR, TrafficLevel.MODERATE, TrafficLevel.SLOW):
        if avg_speed_kmh >= TRAFFIC_SPEED_BANDS[level][0]:
            return level
    return TrafficLevel.CONGESTED


def measured_level(avg_speed_kmh: float | None, *, calibrated: bool, flowing_vehicles: int) -> TrafficLevel | None:
    """The traffic level a detector report supports, or None when it says nothing about traffic.

    A measured speed is classified by `level_for_speed`. A calibrated camera that sees no traffic at
    all (only parked vehicles, or an empty road) is measuring a clear road. Anything else (uncalibrated,
    or vehicles present but none measurable yet) gives no measurement and the last one ages out.
    """
    if avg_speed_kmh is not None:
        return level_for_speed(avg_speed_kmh)
    if calibrated and flowing_vehicles == 0:
        return TrafficLevel.CLEAR
    return None


class _TrafficSource:  # what traffic_status needs from a Camera (keeps it testable without a database)
    status: CameraStatus
    traffic_level: TrafficLevel
    traffic_updated_at: datetime | None


def traffic_status(camera: _TrafficSource, now: datetime) -> TrafficStatus:
    """NORMAL_FLOW / TRAFFIC_JAM from the camera's existing traffic level; UNKNOWN when it cannot be trusted."""
    if camera.status != CameraStatus.LIVE or camera.traffic_updated_at is None:
        return TrafficStatus.UNKNOWN
    if now - camera.traffic_updated_at > timedelta(seconds=settings.traffic_status_max_age_seconds):
        return TrafficStatus.UNKNOWN
    jam = {TrafficLevel(level) for level in settings.traffic_jam_levels}
    return TrafficStatus.TRAFFIC_JAM if camera.traffic_level in jam else TrafficStatus.NORMAL_FLOW


def tracking_key(camera_id: uuid.UUID | str) -> str:
    return f"cameras:tracking:{camera_id}"


def decode_tracking(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None
