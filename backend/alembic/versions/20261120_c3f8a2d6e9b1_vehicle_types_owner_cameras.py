"""Vehicle types on parking, owner-connected occupancy cameras

Revision ID: c3f8a2d6e9b1
Revises: b7d2c4e8a1f3
Create Date: 2026-11-20 09:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3f8a2d6e9b1"
down_revision: str | None = "b7d2c4e8a1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing facilities were listed before vehicle types existed; cars and bikes is what they took.
    op.add_column(
        "parking_locations",
        sa.Column(
            "vehicle_types", postgresql.ARRAY(sa.String(16)), nullable=False, server_default="{car,bike}"
        ),
    )
    op.create_index(
        "ix_parking_locations_vehicle_types", "parking_locations", ["vehicle_types"], postgresql_using="gin"
    )
    op.add_column("parking_locations", sa.Column("occupancy_source", sa.String(32), nullable=True))
    op.add_column("parking_locations", sa.Column("occupancy_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("parking_applications", sa.Column("vehicle_types", postgresql.ARRAY(sa.String(16)), nullable=True))
    # Applications that already completed the property step keep counting as complete.
    op.execute("UPDATE parking_applications SET vehicle_types = '{car,bike}' WHERE parking_type IS NOT NULL")

    op.add_column("cameras", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_cameras_owner_id_users", "cameras", "users", ["owner_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_cameras_owner_id", "cameras", ["owner_id"])
    op.add_column("cameras", sa.Column("source_url", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("cameras", "source_url")
    op.drop_index("ix_cameras_owner_id", table_name="cameras")
    op.drop_constraint("fk_cameras_owner_id_users", "cameras", type_="foreignkey")
    op.drop_column("cameras", "owner_id")
    op.drop_column("parking_applications", "vehicle_types")
    op.drop_column("parking_locations", "occupancy_updated_at")
    op.drop_column("parking_locations", "occupancy_source")
    op.drop_index("ix_parking_locations_vehicle_types", table_name="parking_locations")
    op.drop_column("parking_locations", "vehicle_types")
