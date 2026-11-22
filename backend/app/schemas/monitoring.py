import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.enums import (
    AlertSeverity,
    AlertStatus,
    CameraStatus,
    IncidentStatus,
    ParkingState,
    TrafficLevel,
    ViolationType,
)
from app.schemas.common import ORMModel
from app.schemas.user import UserOut
from app.utils.pagination import PageParams

VIOLATION_LABELS: dict[ViolationType, str] = {
    ViolationType.NO_PARKING_ZONE: "No-parking zone",
    ViolationType.RESTRICTED_LANE: "Restricted lane parking",
    ViolationType.NEAR_INTERSECTION: "Parking near intersection",
    ViolationType.FOOTPATH: "Footpath obstruction",
    ViolationType.DOUBLE_PARKING: "Double parking",
    ViolationType.BUS_STOP: "Bus stop obstruction",
    ViolationType.OVERTIME: "Overtime parking",
    ViolationType.LOADING_ZONE: "Loading zone obstruction",
}


TrackStatus = Literal["moving", "stopped", "parked"]


class TrackedVehicle(BaseModel):
    """One vehicle followed by an AI detector. `track_id` stays the same while the vehicle is in view."""

    track_id: int = Field(ge=0)
    vehicle_type: str = Field(min_length=1, max_length=40)
    status: TrackStatus
    confidence: float = Field(ge=0, le=1)
    speed_kmh: float | None = Field(None, ge=0, le=300)
    stopped_seconds: float = Field(0, ge=0)
    # Bounding box as fractions of the frame: x1, y1, x2, y2.
    box: tuple[float, float, float, float]
    # The Parking Availability Bridge's verdict for this vehicle (police cameras); absent from older detectors.
    parking_state: ParkingState | None = None

    @field_validator("box")
    @classmethod
    def _box_in_frame(cls, value: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        if any(not 0 <= v <= 1 for v in value):
            raise ValueError("Box coordinates must be fractions of the frame between 0 and 1.")
        return value


class TrackingSummary(BaseModel):
    """Headline numbers from the latest tracking update of an AI camera."""

    vehicle_count: int
    moving_count: int
    stopped_count: int
    parked_count: int
    flow_per_minute: int
    avg_speed_kmh: float | None
    updated_at: datetime


class CameraTracking(TrackingSummary):
    counts_by_class: dict[str, int]
    fps: float | None
    tracks: list[TrackedVehicle]


class CameraOut(ORMModel):
    id: uuid.UUID
    code: str
    name: str
    road: str
    area: str
    zone: str
    status: CameraStatus
    traffic_level: TrafficLevel
    avg_speed_kmh: int
    latitude: float
    longitude: float
    last_heartbeat_at: datetime | None
    # Base URL of the AI detector's preview; null for simulated cameras.
    stream_url: str | None = None
    # True once a real AI detector has reported for this camera (it is no longer simulated).
    ai_enabled: bool = False
    # Present while the detector is sending live tracking.
    tracking: TrackingSummary | None = None
    active_violations: int = 0


class CameraTrackingOut(BaseModel):
    camera_id: uuid.UUID
    camera_code: str
    ai_enabled: bool
    traffic_level: TrafficLevel
    avg_speed_kmh: int
    tracking: CameraTracking | None


class CameraFilters(PageParams):
    q: str | None = Field(None, max_length=80, description="Camera code, name, road or area")
    status: CameraStatus | None = None
    area: str | None = Field(None, max_length=80)


class CameraCounts(BaseModel):
    total: int
    live: int
    offline: int
    maintenance: int


class AlertOut(ORMModel):
    id: uuid.UUID
    code: str | None
    camera_id: uuid.UUID
    camera_code: str
    camera_name: str
    road: str
    area: str
    violation_type: ViolationType
    violation_label: str
    severity: AlertSeverity
    status: AlertStatus
    vehicle_type: str
    vehicle_color: str | None
    plate_number: str | None
    confidence: float
    direction: str | None
    detected_at: datetime
    latitude: float
    longitude: float
    assigned_officer_name: str | None
    incident_id: uuid.UUID | None
    closed_at: datetime | None
    dismiss_reason: str | None
    has_snapshot: bool = False
    # Who was sent to this alert: the nearest available officer within the dispatch radius.
    dispatch_status: str | None = None
    dispatch_officer_id: uuid.UUID | None = None
    dispatch_officer_name: str | None = None
    dispatch_distance_m: int | None = None


class AlertFilters(PageParams):
    status: Literal["open", "active", "assigned", "resolved", "dismissed", "closed"] | None = None
    severity: AlertSeverity | None = None
    camera_id: uuid.UUID | None = None
    area: str | None = Field(None, max_length=80)
    violation_type: ViolationType | None = None
    detected_from: datetime | None = None
    detected_to: datetime | None = None
    within_hours: int | None = Field(None, ge=1, le=24 * 31, description="Only alerts from the last N hours")
    q: str | None = Field(None, max_length=40, description="Alert code or plate number")
    sort: Literal["newest", "oldest", "severity"] = "newest"


class AlertCounts(BaseModel):
    open: int
    active: int
    assigned: int
    high_priority: int
    resolved_today: int


class DismissRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


class ResolveRequest(BaseModel):
    resolution: str = Field("Vehicle moved and road cleared.", min_length=3, max_length=255)


class NoteCreate(BaseModel):
    body: str = Field(min_length=2, max_length=2000)


class IncidentNoteOut(ORMModel):
    id: uuid.UUID
    body: str
    author_name: str
    created_at: datetime


class IncidentSummary(ORMModel):
    id: uuid.UUID
    code: str | None
    status: IncidentStatus
    officer_id: uuid.UUID
    officer_name: str
    violation_label: str
    severity: AlertSeverity
    road: str
    camera_code: str
    plate_number: str | None
    created_at: datetime
    resolved_at: datetime | None


class IncidentDetail(IncidentSummary):
    resolution: str | None
    alert: AlertOut
    notes: list[IncidentNoteOut]


class IncidentFilters(PageParams):
    status: IncidentStatus | None = None
    mine: bool = False
    q: str | None = Field(None, max_length=40)


class RoadCondition(BaseModel):
    camera_id: uuid.UUID
    camera_code: str
    road: str
    area: str
    traffic_level: TrafficLevel
    avg_speed_kmh: int
    # "ai" when the figures come from a detector's live tracking, "simulated" for demo cameras.
    source: Literal["ai", "simulated"] = "simulated"
    vehicle_count: int | None = None


class PoliceDashboard(BaseModel):
    officer: UserOut
    alerts: AlertCounts
    cameras: CameraCounts
    latest_alert: AlertOut | None
    open_incidents_mine: int
    road_conditions: list[RoadCondition]


class DetectionIngest(BaseModel):
    """Payload sent by CCTV video-analytics systems."""

    camera_code: str = Field(min_length=3, max_length=16)
    violation_type: ViolationType
    vehicle_type: str = Field(min_length=2, max_length=40)
    vehicle_color: str | None = Field(None, max_length=24)
    plate_number: str | None = Field(None, max_length=32)
    confidence: float = Field(ge=0, le=1)
    direction: str | None = Field(None, max_length=40)
    detected_at: datetime | None = None
    # Optional JPEG/PNG/WEBP crop of the vehicle, base64 encoded (max ~2 MB decoded).
    snapshot_base64: str | None = Field(None, max_length=2_800_000)


class CameraHeartbeat(BaseModel):
    """Sent periodically by an AI detector. Registers the camera on first contact."""

    camera_code: str = Field(min_length=3, max_length=16, pattern=r"^[A-Za-z0-9_-]+$")
    stream_url: str | None = Field(None, max_length=255, pattern=r"^https?://")
    name: str | None = Field(None, min_length=2, max_length=160)
    road: str | None = Field(None, min_length=2, max_length=160)
    area: str | None = Field(None, min_length=2, max_length=80)
    zone: str | None = Field(None, min_length=1, max_length=40)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)


class TelemetryIngest(BaseModel):
    """Live tracking picture sent every few seconds by an AI detector."""

    camera_code: str = Field(min_length=3, max_length=16, pattern=r"^[A-Za-z0-9_-]+$")
    captured_at: datetime | None = None
    vehicle_count: int = Field(ge=0, le=1000)
    moving_count: int = Field(0, ge=0, le=1000)
    stopped_count: int = Field(0, ge=0, le=1000)
    parked_count: int = Field(0, ge=0, le=1000)
    counts_by_class: dict[str, int] = Field(default_factory=dict, max_length=20)
    # Different vehicles seen during the last minute.
    flow_per_minute: int = Field(0, ge=0, le=10_000)
    # Mean speed of the vehicles on the road; null when the camera is not calibrated or the road is empty.
    avg_speed_kmh: float | None = Field(None, ge=0, le=300)
    fps: float | None = Field(None, ge=0, le=240)
    # True when the detector's road is calibrated, so a missing speed means "no traffic", not "unknown".
    speed_calibrated: bool = False
    tracks: list[TrackedVehicle] = Field(default_factory=list, max_length=100)


class TelemetryAccepted(BaseModel):
    camera_id: uuid.UUID
    traffic_level: TrafficLevel
    avg_speed_kmh: int


class HeartbeatAccepted(BaseModel):
    camera_id: uuid.UUID
    camera_code: str
    created: bool
    status: CameraStatus


class DetectorConfig(BaseModel):
    """What an AI detector needs to run a camera: where its video is and what to do with it."""

    camera_code: str
    # "parking": count vehicles for a facility's occupancy and raise no alerts.
    # "traffic": a police camera (tracking, traffic and illegal-parking alerts).
    mode: Literal["parking", "traffic"]
    source_url: str | None
    parking_name: str | None
    capacity: int | None


class LocationUpdate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class DispatchOut(BaseModel):
    alert_id: uuid.UUID
    status: str
    officer_id: uuid.UUID | None
    distance_m: int | None
    message: str


class DeclineRequest(BaseModel):
    reason: str | None = Field(None, max_length=200)


class ParkingStatusUpdate(BaseModel):
    """One vehicle's state from the Parking Availability Bridge. `seq` grows with every change."""

    vehicle_key: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    track_id: int = Field(ge=0)
    state: ParkingState
    seq: int = Field(ge=1)
    changed_at: datetime
    vehicle_type: str = Field(min_length=2, max_length=40)
    confidence: float = Field(ge=0, le=1)
    box: tuple[float, float, float, float]
    stationary_seconds: float = Field(0, ge=0, le=7 * 24 * 3600)
    evidence: dict[str, str | int | float] = Field(default_factory=dict, max_length=10)
    # JPEG crop of the vehicle, base64 (sent with the change to PARKED).
    snapshot_base64: str | None = Field(None, max_length=2_800_000)

    @field_validator("box")
    @classmethod
    def _box_in_frame(cls, value: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        if any(not 0 <= v <= 1 for v in value) or value[2] <= value[0] or value[3] <= value[1]:
            raise ValueError("Box must be x1 < x2, y1 < y2, as fractions of the frame between 0 and 1.")
        return value


class ParkingStatusIngest(BaseModel):
    camera_code: str = Field(min_length=3, max_length=16, pattern=r"^[A-Za-z0-9_-]+$")
    bridge_id: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_.:-]+$")
    violation_type: ViolationType = ViolationType.NO_PARKING_ZONE
    sent_at: datetime | None = None
    vehicles: list[ParkingStatusUpdate] = Field(max_length=50)


class ParkingStatusAccepted(BaseModel):
    applied: int
    keepalive: int
    ignored: int
    # Vehicles currently PARKED on this camera, and how many of them are held back by traffic.
    parked: int
    suppressed: int


class ParkedVehicleOut(ORMModel):
    id: uuid.UUID
    vehicle_key: str
    track_id: int
    state: ParkingState
    vehicle_type: str
    confidence: float
    parked_since: datetime | None
    last_seen_at: datetime
    decision: str
    traffic_status: str | None
    alert_id: uuid.UUID | None
