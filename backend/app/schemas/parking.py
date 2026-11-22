import re
import uuid
from datetime import datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.enums import (
    AvailabilityStatus,
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
    occupied_spaces: int
    availability_status: AvailabilityStatus
    availability_label: str
    parking_type_label: str
    vehicle_types: list[VehicleType]
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
    occupancy_source: OccupancySource | None
    occupancy_updated_at: datetime | None
    created_at: datetime


class ParkingFilters(PageParams):
    q: str | None = Field(None, max_length=80, description="Search by parking name, address or area")
    category: ParkingCategory | None = None
    area: str | None = Field(None, max_length=80)
    available_only: bool = False
    free_only: bool = False
    vehicle_type: VehicleType | None = Field(None, description="Only parking that accepts this vehicle")
    open_now: bool = Field(False, description="Only parking open at this moment (Asia/Kathmandu time)")
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    radius_m: int = Field(5000, ge=100, le=50_000)
    # "recommended" lists parking that can be used right now first, nearest first within each group.
    sort: Literal["recommended", "distance", "name", "available", "price", "newest"] = "distance"


class MapBounds(BaseModel):
    min_lat: float = Field(27.60, ge=-90, le=90)
    min_lng: float = Field(85.20, ge=-180, le=180)
    max_lat: float = Field(27.80, ge=-90, le=90)
    max_lng: float = Field(85.45, ge=-180, le=180)
    vehicle_type: VehicleType | None = None
    # The viewer's position: markers then carry their distance and come back nearest first.
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)


# --------------------------------------------------------------------------- owner occupancy monitoring

CameraConnection = Literal["connected", "waiting", "disconnected", "maintenance"]


class OwnerCameraOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    source_url: str | None
    connection: CameraConnection
    connection_label: str
    last_seen_at: datetime | None
    # Live preview served by the AI detector (…/stream.mjpg, …/snapshot.jpg) while it is connected.
    stream_url: str | None
    # Distinct parked vehicles in the detector's latest report, before confirmation smoothing.
    detected_vehicles: int | None


class OwnerParkingOut(ParkingDetail):
    camera: OwnerCameraOut | None
    # True while a manual correction holds and the camera waits for its view to change.
    manual_hold: bool


class OwnerCameraConnect(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    source_url: str = Field(
        min_length=1, max_length=512, description="RTSP/HTTP address of the CCTV stream, or a local camera index"
    )

    @field_validator("source_url")
    @classmethod
    def _url(cls, value: str) -> str:
        value = value.strip()
        if not value.isdigit() and not re.match(r"^(rtsp|rtsps|rtmp|http|https)://\S+$", value, re.IGNORECASE):
            raise ValueError("Enter the camera's stream address, e.g. rtsp://192.168.1.20:554/stream1.")
        return value


class OccupancyCorrection(BaseModel):
    occupied_spaces: int = Field(ge=0, le=100_000)


class MapMarker(BaseModel):
    id: uuid.UUID
    kind: Literal["parking", "pending", "rejected", "camera", "incident"]
    name: str
    subtitle: str
    latitude: float
    longitude: float
    tone: MarkerTone
    status: str
    distance_m: float | None = None


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


class IssueParking(ORMModel):
    id: uuid.UUID
    name: str
    address: str
    area: str
    latitude: float
    longitude: float


class IssueReporter(ORMModel):
    id: uuid.UUID
    full_name: str
    email: str | None
    phone: str | None


class IssueReportAdminOut(ORMModel):
    """An issue report as administrators see it: with the location and who raised it."""

    id: uuid.UUID
    category: IssueCategory
    description: str
    status: IssueStatus
    created_at: datetime
    updated_at: datetime
    parking: IssueParking
    reporter: IssueReporter


class IssueFilters(PageParams):
    status: IssueStatus | None = None
    category: IssueCategory | None = None
    parking_id: uuid.UUID | None = None
    q: str | None = Field(None, max_length=80, description="Parking name, area, reporter or description")
    sort: Literal["newest", "oldest"] = "newest"


class IssueCounts(BaseModel):
    total: int
    open: int
    reviewed: int
    closed: int


class IssueStatusUpdate(BaseModel):
    status: IssueStatus
