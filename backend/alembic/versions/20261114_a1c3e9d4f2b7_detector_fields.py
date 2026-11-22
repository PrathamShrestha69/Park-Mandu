"""AI detector fields: alert snapshots and detector contact time

Revision ID: a1c3e9d4f2b7
Revises: 9be8725364bb
Create Date: 2026-11-14 08:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'a1c3e9d4f2b7'
down_revision: str | None = '9be8725364bb'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # alerts.snapshot_key was added to the model without a migration, so fresh databases lacked it and
    # some development databases got it by hand. IF NOT EXISTS makes both cases converge.
    op.execute("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS snapshot_key VARCHAR(255)")
    op.execute("ALTER TABLE alerts ALTER COLUMN snapshot_key TYPE VARCHAR(255)")

    op.add_column('cameras', sa.Column('detector_seen_at', sa.DateTime(timezone=True), nullable=True))
    # Cameras that already publish an AI preview (http/https) have been driven by a real detector.
    op.execute(
        "UPDATE cameras SET detector_seen_at = last_heartbeat_at "
        "WHERE stream_url ILIKE 'http://%' OR stream_url ILIKE 'https://%'"
    )
    # Data repair: the demo simulator used to mark every live camera offline on its first run after
    # more than ten minutes of downtime, and nothing brought them back. Cameras that were seeded as
    # offline have a heartbeat hours older than the row itself and are left alone.
    op.execute(
        "UPDATE cameras SET status = 'live' "
        "WHERE status = 'offline' AND detector_seen_at IS NULL "
        "AND last_heartbeat_at >= created_at - INTERVAL '1 hour'"
    )


def downgrade() -> None:
    op.drop_column('cameras', 'detector_seen_at')
    op.drop_column('alerts', 'snapshot_key')
