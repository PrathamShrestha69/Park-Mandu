import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import (
    AlertSeverity,
    AlertStatus,
    CameraStatus,
    IncidentStatus,
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
    stream_url: str | None = None
    active_violations: int = 0


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
    camera_code: str
    road: str
    area: str
    traffic_level: TrafficLevel
    avg_speed_kmh: int


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


class HeartbeatAccepted(BaseModel):
    camera_id: uuid.UUID
    camera_code: str
    created: bool
    status: CameraStatus
