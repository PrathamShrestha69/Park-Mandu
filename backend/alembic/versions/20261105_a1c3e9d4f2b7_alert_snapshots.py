"""alert snapshots from the AI detector

Revision ID: a1c3e9d4f2b7
Revises: 9be8725364bb
Create Date: 2026-11-05 12:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c3e9d4f2b7"
down_revision: str | None = "9be8725364bb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("alerts", sa.Column("snapshot_key", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("alerts", "snapshot_key")
