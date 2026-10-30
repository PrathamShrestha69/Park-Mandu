import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Identity, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import (
    AlertSeverity,
    AlertStatus,
    CameraStatus,
    IncidentStatus,
    TrafficLevel,
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
    stream_url: Mapped[str | None] = mapped_column(String(255))
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    installed_on: Mapped[date | None] = mapped_column(Date)


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

    camera: Mapped[Camera] = relationship(lazy="raise")
    assigned_officer: Mapped[User | None] = relationship(lazy="raise")
    incident: Mapped["Incident | None"] = relationship(back_populates="alert", lazy="raise")


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
