import uuid
from datetime import datetime, time
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import (
    ApplicationEventKind,
    ApplicationStatus,
    AvailableDays,
    DocumentKind,
    DocumentStatus,
    ParkingType,
    PricingMode,
)
from app.models.user import User


class ParkingApplication(UUIDPrimaryKey, Timestamps, Base):
    """A landowner's request to list private land as parking. Built step by step as a server-side draft."""

    __tablename__ = "parking_applications"
    __table_args__ = (Index("ix_parking_applications_status_submitted", "status", "submitted_at"),)

    seq: Mapped[int] = mapped_column(Integer, Identity(start=480), unique=True)
    reference: Mapped[str | None] = mapped_column(String(24), unique=True)
    applicant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[ApplicationStatus] = mapped_column(
        str_enum(ApplicationStatus), default=ApplicationStatus.DRAFT, index=True
    )
    completed_step: Mapped[int] = mapped_column(SmallInteger, default=0)

    # Step 1 — location
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(String(255))
    area: Mapped[str | None] = mapped_column(String(80), index=True)

    # Step 2 — property
    property_name: Mapped[str | None] = mapped_column(String(160))
    land_size_sqm: Mapped[int | None] = mapped_column(Integer)
    capacity: Mapped[int | None] = mapped_column(Integer)
    parking_type: Mapped[ParkingType | None] = mapped_column(str_enum(ParkingType))
    opens_at: Mapped[time | None] = mapped_column(Time)
    closes_at: Mapped[time | None] = mapped_column(Time)
    available_days: Mapped[AvailableDays | None] = mapped_column(str_enum(AvailableDays))
    pricing_mode: Mapped[PricingMode | None] = mapped_column(str_enum(PricingMode))
    price_per_hour: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))

    # Step 3 — owner (government ID is encrypted at rest, only the last 4 digits are readable)
    owner_name: Mapped[str | None] = mapped_column(String(120))
    owner_phone: Mapped[str | None] = mapped_column(String(20))
    gov_id_encrypted: Mapped[str | None] = mapped_column(Text)
    gov_id_last4: Mapped[str | None] = mapped_column(String(4))
    ownership_document_number: Mapped[str | None] = mapped_column(String(64))
    owner_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)

    # Step 5 — review
    declaration_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    feedback: Mapped[str | None] = mapped_column(Text)

    applicant: Mapped[User] = relationship(foreign_keys=[applicant_id], lazy="raise")
    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewer_id], lazy="raise")
    documents: Mapped[list["ApplicationDocument"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="ApplicationDocument.created_at",
        lazy="raise",
    )
    events: Mapped[list["ApplicationEvent"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="ApplicationEvent.created_at",
        lazy="raise",
    )


class ApplicationDocument(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "application_documents"

    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parking_applications.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[DocumentKind] = mapped_column(str_enum(DocumentKind))
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(255))
    thumbnail_key: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[DocumentStatus] = mapped_column(str_enum(DocumentStatus), default=DocumentStatus.PROCESSING)

    application: Mapped[ParkingApplication] = relationship(back_populates="documents", lazy="raise")


class ApplicationEvent(UUIDPrimaryKey, Timestamps, Base):
    """Timeline of an application's review — shown to the applicant and the reviewing officer."""

    __tablename__ = "application_events"

    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parking_applications.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[ApplicationEventKind] = mapped_column(str_enum(ApplicationEventKind))
    message: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    application: Mapped[ParkingApplication] = relationship(back_populates="events", lazy="raise")
    actor: Mapped[User | None] = relationship(lazy="raise")
