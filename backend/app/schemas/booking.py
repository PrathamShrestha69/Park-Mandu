import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.enums import BookingKind, BookingStatus, PaymentProvider, PaymentStatus, ReconciliationState
from app.schemas.common import ORMModel
from app.utils.pagination import PageParams

# What a driver sees, derived from the booking and its payments.
DisplayStatus = Literal[
    "awaiting_payment",  # space held, not paid yet
    "payment_pending",  # sent to the provider; waiting for its confirmation
    "active",  # paid and verified, parking time running
    "ended",
    "expired",  # hold ran out without a verified payment
    "cancelled",
    "needs_attention",  # money received but the booking could not be confirmed: refund on its way
]


class ProviderOut(BaseModel):
    id: PaymentProvider
    label: str
    enabled: bool
    min_amount: Decimal
    environment: Literal["sandbox", "production"]


class BookingQuote(BaseModel):
    parking_id: uuid.UUID
    hours: int
    price_per_hour: Decimal
    amount: Decimal
    currency: str = "NPR"
    bookable_spaces: int
    max_hours: int
    closes_at: datetime | None
    hold_minutes: int
    providers: list[ProviderOut]


class BookingCreate(BaseModel):
    parking_id: uuid.UUID
    hours: int = Field(ge=1, le=24)
    vehicle_plate: str | None = Field(None, max_length=32)

    @field_validator("vehicle_plate")
    @classmethod
    def _plate(cls, value: str | None) -> str | None:
        cleaned = " ".join((value or "").split())
        return cleaned or None


class ExtensionCreate(BaseModel):
    hours: int = Field(ge=1, le=24)


class PaymentStart(BaseModel):
    provider: PaymentProvider
    # Web page or app deep link to come back to after paying; must be on the allow-list.
    return_url: str = Field(min_length=8, max_length=500)


class PaymentOut(ORMModel):
    id: uuid.UUID
    provider: PaymentProvider
    provider_label: str
    status: PaymentStatus
    amount: Decimal
    transaction_uuid: str
    provider_transaction_id: str | None
    created_at: datetime
    completed_at: datetime | None
    failure_reason: str | None
    reconciliation: ReconciliationState
    reconciliation_note: str | None
    # Only while the payment can still be finished at the provider.
    checkout_url: str | None


class ParkingBrief(BaseModel):
    id: uuid.UUID
    name: str
    address: str
    latitude: float
    longitude: float


class BookingSummary(ORMModel):
    id: uuid.UUID
    reference: str | None
    kind: BookingKind
    parent_id: uuid.UUID | None
    status: BookingStatus
    display_status: DisplayStatus
    hours: int
    price_per_hour: Decimal
    amount: Decimal
    currency: str
    vehicle_plate: str | None
    hold_expires_at: datetime | None
    starts_at: datetime | None
    ends_at: datetime | None
    confirmed_at: datetime | None
    created_at: datetime
    parking: ParkingBrief


class BookingDetail(BookingSummary):
    payments: list[PaymentOut]
    extensions: list[BookingSummary]
    # The latest payment state worth telling the driver about (success, failure, pending, cancelled).
    latest_payment: PaymentOut | None
    can_pay: bool
    can_cancel: bool
    can_extend: bool
    max_extension_hours: int


class CheckoutOut(BaseModel):
    booking_id: uuid.UUID
    payment: PaymentOut
    # Open this in the browser (web) or an in-app browser (mobile).
    checkout_url: str


class BookingFilters(PageParams):
    scope: Literal["all", "active", "past"] = "all"


class ReconciliationItem(BaseModel):
    payment: PaymentOut
    booking_reference: str | None
    booking_id: uuid.UUID
    user_name: str
    parking_name: str


class ResolveRequest(BaseModel):
    note: str = Field(min_length=3, max_length=250)
