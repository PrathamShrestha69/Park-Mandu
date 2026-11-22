"""Paid parking: bookings (a held or confirmed space for a number of hours) and their payments."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Identity, Index, Integer, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import BookingKind, BookingStatus, PaymentProvider, PaymentStatus, ReconciliationState
from app.models.parking import ParkingLocation
from app.models.user import User


class Booking(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("ix_bookings_parking_status", "parking_id", "status"),
        # One space-holding checkout per driver per facility at a time (double clicks, two tabs).
        Index(
            "uq_bookings_one_pending_hold",
            "user_id",
            "parking_id",
            unique=True,
            postgresql_where=text("status = 'pending_payment' AND kind = 'initial'"),
        ),
    )

    seq: Mapped[int] = mapped_column(Integer, Identity(start=7100), unique=True)
    reference: Mapped[str | None] = mapped_column(String(20), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    parking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("parking_locations.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[BookingKind] = mapped_column(str_enum(BookingKind), default=BookingKind.INITIAL)
    # For an extension: the booking it adds hours to.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    status: Mapped[BookingStatus] = mapped_column(
        str_enum(BookingStatus), default=BookingStatus.PENDING_PAYMENT, index=True
    )
    hours: Mapped[int] = mapped_column(Integer)
    # Price at the time of booking; a later price change never alters what the driver agreed to pay.
    price_per_hour: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3), default="NPR")
    vehicle_plate: Mapped[str | None] = mapped_column(String(32))
    hold_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The verified payment that confirmed this booking. Unique: one payment confirms one booking, once.
    paid_payment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("payments.id", ondelete="SET NULL", use_alter=True, name="fk_bookings_paid_payment_id_payments"),
        unique=True,
    )

    user: Mapped[User] = relationship(lazy="raise")
    parking: Mapped[ParkingLocation] = relationship(lazy="raise")
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="booking",
        foreign_keys="Payment.booking_id",
        order_by="Payment.created_at",
        lazy="raise",
    )


class Payment(UUIDPrimaryKey, Timestamps, Base):
    """One attempt to pay for a booking with eSewa or Khalti. Retries create new attempts."""

    __tablename__ = "payments"
    __table_args__ = (
        # The same provider transaction can never be counted twice (replayed callback, forged reuse).
        UniqueConstraint("provider", "provider_transaction_id", name="uq_payments_provider_transaction"),
        UniqueConstraint("provider", "provider_reference", name="uq_payments_provider_reference"),
        Index("ix_payments_status_created", "status", "created_at"),
    )

    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[PaymentProvider] = mapped_column(str_enum(PaymentProvider))
    status: Mapped[PaymentStatus] = mapped_column(str_enum(PaymentStatus), default=PaymentStatus.INITIATED)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    # Our id for this attempt, sent to the provider (eSewa transaction_uuid / Khalti purchase_order_id).
    transaction_uuid: Mapped[str] = mapped_column(String(64), unique=True)
    # The provider's id for the checkout session (Khalti pidx).
    provider_reference: Mapped[str | None] = mapped_column(String(64))
    # The provider's id for the money movement (eSewa transaction_code / ref_id, Khalti transaction_id).
    provider_transaction_id: Mapped[str | None] = mapped_column(String(64))
    checkout_url: Mapped[str | None] = mapped_column(String(1024))
    provider_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Where the driver goes after the provider (web page or app deep link); validated on creation.
    return_url: Mapped[str] = mapped_column(String(512))
    # Base URL of this API the provider sends the driver back to (eSewa success/failure, Khalti return).
    callback_base_url: Mapped[str] = mapped_column(String(255))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    check_count: Mapped[int] = mapped_column(Integer, default=0)
    failure_reason: Mapped[str | None] = mapped_column(String(255))
    reconciliation: Mapped[ReconciliationState] = mapped_column(
        str_enum(ReconciliationState), default=ReconciliationState.NONE, index=True
    )
    reconciliation_note: Mapped[str | None] = mapped_column(String(255))
    # Last answer from the provider (no secrets), for support and audits.
    provider_response: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    booking: Mapped[Booking] = relationship(back_populates="payments", foreign_keys=[booking_id], lazy="raise")
