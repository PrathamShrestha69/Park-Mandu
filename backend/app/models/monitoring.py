import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Identity, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import (
    AlertSeverity,
    AlertStatus,
    CameraStatus,
    DispatchStatus,
    EnforcementDecision,
    IncidentStatus,
    ParkingState,
    TrafficLevel,
    TrafficStatus,
    ViolationType,
)
from app.models.mixins import GeoPoint
from app.models.user import User


class Camera(UUIDPrimaryKey, Timestamps, GeoPoint, Base):
    __tablename__ = "cameras"

    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    road: Mapped[str] = mapped_column(String(160))
    area: Mapped[str] = mapped_column(String(80), index=True)
    zone: Mapped[str] = mapped_column(String(40))
    status: Mapped[CameraStatus] = mapped_column(str_enum(CameraStatus), default=CameraStatus.LIVE, index=True)
    traffic_level: Mapped[TrafficLevel] = mapped_column(str_enum(TrafficLevel), default=TrafficLevel.CLEAR)
    avg_speed_kmh: Mapped[int] = mapped_column(Integer, default=30)
    # When traffic_level was last measured (detector speed or the demo simulator). NULL = never measured.
    # Illegal-parking alerts treat a missing or old measurement as "traffic unknown" and hold back.
    traffic_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Base URL of the AI service's live preview for this camera (it serves /stream.mjpg and /snapshot.jpg).
    stream_url: Mapped[str | None] = mapped_column(String(255))
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Last contact from a real AI detector (heartbeat or live tracking). NULL means the camera has only
    # ever been driven by the demo simulator.
    detector_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    installed_on: Mapped[date | None] = mapped_column(Date)
    # The parking facility this camera watches. Its vehicle count drives that facility's occupancy.
    parking_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("parking_locations.id", ondelete="SET NULL"), index=True
    )
    # Set for a CCTV camera a parking owner connected to their own facility. Such cameras only count
    # occupancy: they never raise police alerts and stay out of the police console.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Address the AI detector reads the video from (RTSP/HTTP), as entered by the owner.
    source_url: Mapped[str | None] = mapped_column(String(512))

    @property
    def ai_enabled(self) -> bool:
        return self.detector_seen_at is not None


# Cameras that belong to the police network (everything except owner-connected parking cameras).
POLICE_CAMERA = Camera.owner_id.is_(None)


class Alert(UUIDPrimaryKey, Timestamps, GeoPoint, Base):
    """An illegal-parking detection raised by a CCTV camera's video analytics."""

    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_status_severity_detected", "status", "severity", "detected_at"),)

    seq: Mapped[int] = mapped_column(Integer, Identity(start=5200), unique=True)
    code: Mapped[str | None] = mapped_column(String(20), unique=True)
    camera_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), index=True)
    violation_type: Mapped[ViolationType] = mapped_column(str_enum(ViolationType), index=True)
    severity: Mapped[AlertSeverity] = mapped_column(str_enum(AlertSeverity), index=True)
    status: Mapped[AlertStatus] = mapped_column(str_enum(AlertStatus), default=AlertStatus.ACTIVE, index=True)
    vehicle_type: Mapped[str] = mapped_column(String(40))
    vehicle_color: Mapped[str | None] = mapped_column(String(24))
    plate_number: Mapped[str | None] = mapped_column(String(32), index=True)
    confidence: Mapped[float] = mapped_column(Float)
    direction: Mapped[str | None] = mapped_column(String(40))
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    assigned_officer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismiss_reason: Mapped[str | None] = mapped_column(String(255))
    # Storage key of the vehicle crop sent by the AI detector (see services/storage.py).
    snapshot_key: Mapped[str | None] = mapped_column(String(255))

    camera: Mapped[Camera] = relationship(lazy="raise")
    assigned_officer: Mapped[User | None] = relationship(lazy="raise")
    incident: Mapped["Incident | None"] = relationship(back_populates="alert", lazy="raise")
    dispatch: Mapped["AlertDispatch | None"] = relationship(lazy="raise", viewonly=True)


class Incident(UUIDPrimaryKey, Timestamps, Base):
    """Created when an officer takes ownership of an alert; tracks field response until resolution."""

    __tablename__ = "incidents"

    seq: Mapped[int] = mapped_column(Integer, Identity(start=28400), unique=True)
    code: Mapped[str | None] = mapped_column(String(20), unique=True)
    alert_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), unique=True)
    officer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    status: Mapped[IncidentStatus] = mapped_column(
        str_enum(IncidentStatus), default=IncidentStatus.IN_PROGRESS, index=True
    )
    resolution: Mapped[str | None] = mapped_column(String(255))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    alert: Mapped[Alert] = relationship(back_populates="incident", lazy="raise")
    officer: Mapped[User] = relationship(lazy="raise")
    notes: Mapped[list["IncidentNote"]] = relationship(
        back_populates="incident",
        cascade="all, delete-orphan",
        order_by="IncidentNote.created_at",
        lazy="raise",
    )


class IncidentNote(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "incident_notes"

    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)

    incident: Mapped[Incident] = relationship(back_populates="notes", lazy="raise")
    author: Mapped[User] = relationship(lazy="raise")


class AlertDispatch(UUIDPrimaryKey, Timestamps, Base):
    """Which single officer an alert was sent to. One row per alert, so an incident is never notified twice."""

    __tablename__ = "alert_dispatches"

    alert_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), unique=True)
    officer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    status: Mapped[DispatchStatus] = mapped_column(str_enum(DispatchStatus), index=True)
    distance_m: Mapped[float | None] = mapped_column(Float)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Officers who declined; the next-nearest one is tried, never someone who already said no.
    declined_officer_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)

    alert: Mapped[Alert] = relationship(lazy="raise")
    officer: Mapped[User | None] = relationship(lazy="raise")


class ParkedVehicle(UUIDPrimaryKey, Timestamps, Base):
    """A vehicle the Parking Availability Bridge is tracking on a police camera, and what enforcement did.

    One row per vehicle key. Updates carry a sequence number per vehicle, so a repeated or late update
    from the bridge never moves the state backwards, and one vehicle is alerted at most once.
    """

    __tablename__ = "parked_vehicles"
    __table_args__ = (Index("ix_parked_vehicles_camera_state", "camera_id", "state"),)

    camera_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), index=True)
    vehicle_key: Mapped[str] = mapped_column(String(64), unique=True)
    bridge_id: Mapped[str] = mapped_column(String(32))
    track_id: Mapped[int] = mapped_column(Integer)
    state: Mapped[ParkingState] = mapped_column(str_enum(ParkingState))
    last_seq: Mapped[int] = mapped_column(Integer)
    vehicle_type: Mapped[str] = mapped_column(String(40))
    confidence: Mapped[float] = mapped_column(Float)
    # Bounding box as fractions of the frame (x1, y1, x2, y2); used to recognise the same vehicle again.
    box: Mapped[list[float]] = mapped_column(JSONB)
    violation_type: Mapped[ViolationType] = mapped_column(str_enum(ViolationType))
    parked_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Last time the bridge reported this vehicle (changes and keepalives). Stale means no longer observed.
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    evidence: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
    snapshot_key: Mapped[str | None] = mapped_column(String(255))
    decision: Mapped[EnforcementDecision] = mapped_column(
        str_enum(EnforcementDecision), default=EnforcementDecision.PENDING, index=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Traffic status seen at the latest assessment, for the officer's and the auditor's benefit.
    traffic_status: Mapped[TrafficStatus | None] = mapped_column(str_enum(TrafficStatus))
    # The alert raised for this vehicle; set once, under a row lock, so a vehicle is never alerted twice.
    # Not unique: after a bridge restart the same car arrives under a new key and is linked to its open alert.
    alert_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"), index=True)

    camera: Mapped[Camera] = relationship(lazy="raise")
