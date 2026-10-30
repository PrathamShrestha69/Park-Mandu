import re
import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.enums import (
    ApplicationEventKind,
    ApplicationStatus,
    AvailableDays,
    DocumentKind,
    DocumentStatus,
    ParkingType,
    PricingMode,
)
from app.schemas.common import ORMModel
from app.schemas.user import PhoneNumber
from app.utils.pagination import PageParams

# Applications are accepted for locations inside Nepal only.
NEPAL_LAT = (26.3, 30.5)
NEPAL_LNG = (80.0, 88.3)


class LocationStep(BaseModel):
    latitude: float
    longitude: float
    address: str = Field(min_length=5, max_length=255)
    area: str | None = Field(None, max_length=80)

    @model_validator(mode="after")
    def _inside_nepal(self) -> Self:
        if not (NEPAL_LAT[0] <= self.latitude <= NEPAL_LAT[1]) or not (NEPAL_LNG[0] <= self.longitude <= NEPAL_LNG[1]):
            raise ValueError("The selected location must be inside Nepal.")
        return self


class PropertyStep(BaseModel):
    property_name: str = Field(min_length=3, max_length=160)
    land_size_sqm: int | None = Field(None, ge=10, le=1_000_000)
    capacity: int = Field(ge=1, le=2000)
    parking_type: ParkingType
    opens_at: time
    closes_at: time
    available_days: AvailableDays
    pricing_mode: PricingMode
    price_per_hour: Decimal | None = Field(None, ge=0, le=10_000, decimal_places=2)

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.opens_at == self.closes_at:
            raise ValueError("Opening and closing time cannot be the same.")
        if self.pricing_mode == PricingMode.HOURLY and not self.price_per_hour:
            raise ValueError("Enter the hourly price for paid parking.")
        if self.pricing_mode == PricingMode.FREE:
            self.price_per_hour = None
        return self


class OwnerStep(BaseModel):
    owner_name: str = Field(min_length=3, max_length=120)
    owner_phone: PhoneNumber
    government_id: str = Field(min_length=5, max_length=32)
    ownership_document_number: str = Field(min_length=3, max_length=64)
    owner_confirmed: Literal[True] = Field(
        description="Applicant confirms they are the legal owner or an authorised representative"
    )

    @field_validator("government_id")
    @classmethod
    def _gov_id(cls, value: str) -> str:
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9\-/ ]{3,31}", value):
            raise ValueError("Use letters, numbers, '-' or '/' only.")
        return value


class SubmitRequest(BaseModel):
    declaration_accepted: Literal[True]


class DocumentOut(ORMModel):
    id: uuid.UUID
    kind: DocumentKind
    original_name: str
    content_type: str
    size_bytes: int
    status: DocumentStatus
    has_thumbnail: bool
    created_at: datetime


class ApplicationEventOut(ORMModel):
    id: uuid.UUID
    kind: ApplicationEventKind
    message: str | None
    actor_name: str | None
    created_at: datetime


class ApplicationSummary(ORMModel):
    id: uuid.UUID
    reference: str | None
    status: ApplicationStatus
    property_name: str | None
    address: str | None
    area: str | None
    capacity: int | None
    completed_step: int
    applicant_name: str
    document_count: int
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ApplicationDetail(ApplicationSummary):
    latitude: float | None
    longitude: float | None
    land_size_sqm: int | None
    parking_type: ParkingType | None
    opens_at: time | None
    closes_at: time | None
    available_days: AvailableDays | None
    pricing_mode: PricingMode | None
    price_per_hour: Decimal | None
    owner_name: str | None
    owner_phone: str | None
    gov_id_masked: str | None
    ownership_document_number: str | None
    owner_confirmed: bool
    declaration_accepted: bool
    feedback: str | None
    decided_at: datetime | None
    reviewer_name: str | None
    applicant_phone: str | None
    applicant_email: str | None
    applicant_verified: bool
    parking_location_id: uuid.UUID | None
    documents: list[DocumentOut]
    events: list[ApplicationEventOut]
    missing: list[str] = Field(description="Requirements still missing before submission")


class ApplicationFilters(PageParams):
    status: ApplicationStatus | Literal["pending"] | None = None
    q: str | None = Field(None, max_length=80, description="Reference, property, applicant or address")
    area: str | None = Field(None, max_length=80)
    submitted_from: date | None = None
    submitted_to: date | None = None
    sort: Literal["newest", "oldest", "capacity"] = "newest"


class DecisionRequest(BaseModel):
    decision: Literal["approve", "reject", "request_changes", "request_documents"]
    feedback: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _feedback_required(self) -> Self:
        if self.decision != "approve" and len((self.feedback or "").strip()) < 10:
            raise ValueError("Give the applicant a clear reason (at least 10 characters).")
        return self


class StatusCounts(BaseModel):
    total: int
    draft: int
    pending: int
    approved: int
    rejected: int
    changes_requested: int
