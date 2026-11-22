"""Keep five police cameras active and take the other placeholder cameras offline

CAM-014 is the phone IP camera, CAM-021 the demo video, and CAM-001 / CAM-018 / CAM-029 stay as
simulated cameras. Every other police camera is set offline. Parking owners' cameras are not touched,
and a camera whose AI detector connects later comes back live by itself (heartbeat).

Revision ID: e4c1a8f3b2d6
Revises: d9a4b7c2e5f1
Create Date: 2026-11-23 09:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4c1a8f3b2d6"
down_revision: str | None = "d9a4b7c2e5f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIVE = ("CAM-001", "CAM-014", "CAM-018", "CAM-021", "CAM-029")


def upgrade() -> None:
    # Databases migrated by an older alert_snapshots migration that reused revision a1c3e9d4f2b7 never
    # ran detector_fields, so they lack these columns. IF NOT EXISTS makes every database converge.
    op.execute("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS snapshot_key VARCHAR(255)")
    op.execute("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS detector_seen_at TIMESTAMP WITH TIME ZONE")

    codes = sa.bindparam("codes", value=list(ACTIVE), expanding=True)
    op.get_bind().execute(
        sa.text(
            "UPDATE cameras SET status = 'offline', updated_at = now() "
            "WHERE owner_id IS NULL AND code NOT IN :codes AND status <> 'offline'"
        ).bindparams(codes)
    )
    op.get_bind().execute(
        sa.text(
            "UPDATE cameras SET status = 'live', last_heartbeat_at = now(), updated_at = now() "
            "WHERE owner_id IS NULL AND code IN :codes AND status <> 'live'"
        ).bindparams(codes)
    )


def downgrade() -> None:
    # Which cameras were live before is not recorded; leave statuses as they are.
    pass
