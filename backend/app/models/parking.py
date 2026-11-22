import uuid
from datetime import datetime, time
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, Time
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import (
    AvailableDays,
    IssueCategory,
    IssueStatus,
    OccupancySource,
    ParkingCategory,
    ParkingStatus,
    ParkingType,
    PricingMode,
    VehicleType,
)
from app.models.mixins import GeoPoint
from app.models.user import User


class ParkingLocation(UUIDPrimaryKey, Timestamps, GeoPoint, Base):
    __tablename__ = "parking_locations"
    __table_args__ = (
        CheckConstraint("available_spaces >= 0 AND available_spaces <= capacity", name="available_within_capacity"),
        Index(
            "ix_parking_locations_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
        Index("ix_parking_locations_vehicle_types", "vehicle_types", postgresql_using="gin"),
    )

    name: Mapped[str] = mapped_column(String(160))
    address: Mapped[str] = mapped_column(String(255))
    area: Mapped[str] = mapped_column(String(80), index=True)
    category: Mapped[ParkingCategory] = mapped_column(str_enum(ParkingCategory), index=True)
    parking_type: Mapped[ParkingType] = mapped_column(str_enum(ParkingType))
    capacity: Mapped[int] = mapped_column(Integer)
    available_spaces: Mapped[int] = mapped_column(Integer)
    # Vehicles the facility accepts (VehicleType values). Drivers filter listings by these.
    vehicle_types: Mapped[list[str]] = mapped_column(
        ARRAY(String(16)), server_default="{car,bike}", default=lambda: [VehicleType.CAR.value, VehicleType.BIKE.value]
    )
    # Who set the occupancy last (the AI camera or the owner/admin by hand) and when.
    occupancy_source: Mapped[OccupancySource | None] = mapped_column(str_enum(OccupancySource))
    occupancy_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    land_size_sqm: Mapped[int | None] = mapped_column(Integer)
    opens_at: Mapped[time] = mapped_column(Time)
    closes_at: Mapped[time] = mapped_column(Time)
    available_days: Mapped[AvailableDays] = mapped_column(str_enum(AvailableDays))
    pricing_mode: Mapped[PricingMode] = mapped_column(str_enum(PricingMode))
    price_per_hour: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    managed_by: Mapped[str] = mapped_column(String(160))
    contact_phone: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[ParkingStatus] = mapped_column(str_enum(ParkingStatus), default=ParkingStatus.OPEN, index=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("parking_applications.id", ondelete="SET NULL"), unique=True
    )

    owner: Mapped[User | None] = relationship(lazy="raise")


class IssueReport(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "issue_reports"

    parking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("parking_locations.id", ondelete="CASCADE"), index=True)
    reporter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    category: Mapped[IssueCategory] = mapped_column(str_enum(IssueCategory))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[IssueStatus] = mapped_column(str_enum(IssueStatus), default=IssueStatus.OPEN, index=True)

    parking: Mapped[ParkingLocation] = relationship(lazy="raise")
    reporter: Mapped[User] = relationship(lazy="raise")
