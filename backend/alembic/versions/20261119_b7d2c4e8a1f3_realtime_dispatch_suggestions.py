"""Officer locations, alert dispatches, camera-parking link, suggestions

Revision ID: b7d2c4e8a1f3
Revises: a1c3e9d4f2b7
Create Date: 2026-11-19 09:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b7d2c4e8a1f3"
down_revision: str | None = "a1c3e9d4f2b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.add_column("users", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("users", sa.Column("longitude", sa.Float(), nullable=True))
    op.add_column("users", sa.Column("location_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("cameras", sa.Column("parking_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_cameras_parking_id_parking_locations",
        "cameras",
        "parking_locations",
        ["parking_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_cameras_parking_id", "cameras", ["parking_id"])

    # Keep the stored figure inside the physical limits; the application keeps it there from now on.
    op.execute("UPDATE parking_locations SET available_spaces = LEAST(GREATEST(available_spaces, 0), capacity)")
    op.create_check_constraint(
        op.f("ck_parking_locations_available_within_capacity"),
        "parking_locations",
        "available_spaces >= 0 AND available_spaces <= capacity",
    )

    op.create_table(
        "alert_dispatches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("alert_id", sa.Uuid(), sa.ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("officer_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("declined_officer_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        *_timestamps(),
        sa.UniqueConstraint("alert_id", name="uq_alert_dispatches_alert_id"),
    )
    op.create_index("ix_alert_dispatches_officer_id", "alert_dispatches", ["officer_id"])
    op.create_index("ix_alert_dispatches_status", "alert_dispatches", ["status"])
    op.create_index("ix_alert_dispatches_created_at", "alert_dispatches", ["created_at"])

    op.create_table(
        "suggestions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("admin_note", sa.String(500), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_suggestions_user_id", "suggestions", ["user_id"])
    op.create_index("ix_suggestions_fingerprint", "suggestions", ["fingerprint"])
    op.create_index("ix_suggestions_created_at", "suggestions", ["created_at"])
    op.create_index("ix_suggestions_status_created", "suggestions", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("suggestions")
    op.drop_table("alert_dispatches")
    op.drop_constraint(op.f("ck_parking_locations_available_within_capacity"), "parking_locations", type_="check")
    op.drop_index("ix_cameras_parking_id", table_name="cameras")
    op.drop_constraint("fk_cameras_parking_id_parking_locations", "cameras", type_="foreignkey")
    op.drop_column("cameras", "parking_id")
    op.drop_column("users", "location_updated_at")
    op.drop_column("users", "longitude")
    op.drop_column("users", "latitude")
