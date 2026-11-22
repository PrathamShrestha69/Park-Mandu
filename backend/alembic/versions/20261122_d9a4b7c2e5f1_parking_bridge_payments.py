"""Parking Availability Bridge, traffic freshness, paid bookings with eSewa / Khalti payments

Revision ID: d9a4b7c2e5f1
Revises: c3f8a2d6e9b1
Create Date: 2026-11-22 09:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d9a4b7c2e5f1"
down_revision: str | None = "c3f8a2d6e9b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    # When each camera's traffic level was last measured. Existing cameras start "never measured":
    # the simulator or the AI detector fills it in within a minute.
    op.add_column("cameras", sa.Column("traffic_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "parked_vehicles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("camera_id", sa.Uuid(), nullable=False),
        sa.Column("vehicle_key", sa.String(64), nullable=False),
        sa.Column("bridge_id", sa.String(32), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("last_seq", sa.Integer(), nullable=False),
        sa.Column("vehicle_type", sa.String(40), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("box", postgresql.JSONB(), nullable=False),
        sa.Column("violation_type", sa.String(32), nullable=False),
        sa.Column("parked_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evidence", postgresql.JSONB(), nullable=False),
        sa.Column("snapshot_key", sa.String(255), nullable=True),
        sa.Column("decision", sa.String(32), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("traffic_status", sa.String(32), nullable=True),
        sa.Column("alert_id", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["camera_id"], ["cameras.id"], name="fk_parked_vehicles_camera_id_cameras", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], name="fk_parked_vehicles_alert_id_alerts", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_parked_vehicles"),
        sa.UniqueConstraint("vehicle_key", name="uq_parked_vehicles_vehicle_key"),
    )
    op.create_index("ix_parked_vehicles_camera_id", "parked_vehicles", ["camera_id"])
    op.create_index("ix_parked_vehicles_camera_state", "parked_vehicles", ["camera_id", "state"])
    op.create_index("ix_parked_vehicles_last_seen_at", "parked_vehicles", ["last_seen_at"])
    op.create_index("ix_parked_vehicles_decision", "parked_vehicles", ["decision"])
    op.create_index("ix_parked_vehicles_created_at", "parked_vehicles", ["created_at"])
    op.create_index("ix_parked_vehicles_alert_id", "parked_vehicles", ["alert_id"])

    op.create_table(
        "bookings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), sa.Identity(start=7100), nullable=False),
        sa.Column("reference", sa.String(20), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("parking_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("hours", sa.Integer(), nullable=False),
        sa.Column("price_per_hour", sa.Numeric(8, 2), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("vehicle_plate", sa.String(32), nullable=True),
        sa.Column("hold_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_payment_id", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_bookings_user_id_users", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["parking_id"], ["parking_locations.id"], name="fk_bookings_parking_id_parking_locations", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["parent_id"], ["bookings.id"], name="fk_bookings_parent_id_bookings", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_bookings"),
        sa.UniqueConstraint("seq", name="uq_bookings_seq"),
        sa.UniqueConstraint("reference", name="uq_bookings_reference"),
        sa.UniqueConstraint("paid_payment_id", name="uq_bookings_paid_payment_id"),
    )
    for column in ("user_id", "parking_id", "parent_id", "status", "hold_expires_at", "ends_at", "created_at"):
        op.create_index(f"ix_bookings_{column}", "bookings", [column])
    op.create_index("ix_bookings_parking_status", "bookings", ["parking_id", "status"])
    op.create_index(
        "uq_bookings_one_pending_hold",
        "bookings",
        ["user_id", "parking_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending_payment' AND kind = 'initial'"),
    )

    op.create_table(
        "payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("booking_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("transaction_uuid", sa.String(64), nullable=False),
        sa.Column("provider_reference", sa.String(64), nullable=True),
        sa.Column("provider_transaction_id", sa.String(64), nullable=True),
        sa.Column("checkout_url", sa.String(1024), nullable=True),
        sa.Column("provider_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("return_url", sa.String(512), nullable=False),
        sa.Column("callback_base_url", sa.String(255), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_reason", sa.String(255), nullable=True),
        sa.Column("reconciliation", sa.String(32), nullable=False, server_default="none"),
        sa.Column("reconciliation_note", sa.String(255), nullable=True),
        sa.Column("provider_response", postgresql.JSONB(), nullable=False, server_default="{}"),
        *_timestamps(),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], name="fk_payments_booking_id_bookings", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_payments_user_id_users", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_payments"),
        sa.UniqueConstraint("transaction_uuid", name="uq_payments_transaction_uuid"),
        sa.UniqueConstraint("provider", "provider_transaction_id", name="uq_payments_provider_transaction"),
        sa.UniqueConstraint("provider", "provider_reference", name="uq_payments_provider_reference"),
    )
    for column in ("booking_id", "user_id", "reconciliation", "created_at"):
        op.create_index(f"ix_payments_{column}", "payments", [column])
    op.create_index("ix_payments_status_created", "payments", ["status", "created_at"])
    op.create_foreign_key(
        "fk_bookings_paid_payment_id_payments", "bookings", "payments", ["paid_payment_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint("fk_bookings_paid_payment_id_payments", "bookings", type_="foreignkey")
    op.drop_table("payments")
    op.drop_table("bookings")
    op.drop_table("parked_vehicles")
    op.drop_column("cameras", "traffic_updated_at")
