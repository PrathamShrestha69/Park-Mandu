import uuid
from datetime import datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import (
    AvailableDays,
    IssueCategory,
    ParkingCategory,
    ParkingStatus,
    ParkingType,
    PricingMode,
)
from app.schemas.common import ORMModel
from app.utils.pagination import PageParams

MarkerTone = Literal["green", "blue", "gray", "red", "amber", "camera", "incident"]


class ParkingSummary(ORMModel):
    id: uuid.UUID
    name: str
    address: str
    area: str
    category: ParkingCategory
    parking_type: ParkingType
    capacity: int
    available_spaces: int
    pricing_mode: PricingMode
    price_per_hour: Decimal | None
    status: ParkingStatus
    latitude: float
    longitude: float
    opens_at: time
    closes_at: time
    available_days: AvailableDays
    distance_m: float | None = None
    marker_tone: MarkerTone
    is_open_now: bool


class ParkingDetail(ParkingSummary):
    managed_by: str
    contact_phone: str | None
    land_size_sqm: int | None
    is_owner_verified: bool
    created_at: datetime


class ParkingFilters(PageParams):
    q: str | None = Field(None, max_length=80, description="Search by parking name, address or area")
    category: ParkingCategory | None = None
    area: str | None = Field(None, max_length=80)
    available_only: bool = False
    free_only: bool = False
    open_now: bool = Field(False, description="Only parking open at this moment (Asia/Kathmandu time)")
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    radius_m: int = Field(5000, ge=100, le=50_000)
    sort: Literal["distance", "name", "available", "price", "newest"] = "distance"


class MapBounds(BaseModel):
    min_lat: float = Field(27.60, ge=-90, le=90)
    min_lng: float = Field(85.20, ge=-180, le=180)
    max_lat: float = Field(27.80, ge=-90, le=90)
    max_lng: float = Field(85.45, ge=-180, le=180)


class MapMarker(BaseModel):
    id: uuid.UUID
    kind: Literal["parking", "pending", "rejected", "camera", "incident"]
    name: str
    subtitle: str
    latitude: float
    longitude: float
    tone: MarkerTone
    status: str


class IssueReportCreate(BaseModel):
    category: IssueCategory
    description: str = Field(min_length=10, max_length=1000)


class IssueReportOut(ORMModel):
    id: uuid.UUID
    parking_id: uuid.UUID
    category: IssueCategory
    description: str
    status: str
    created_at: datetime
