import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import AuditLog
from app.models.user import User


def record(
    db: AsyncSession,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    ip_address: str | None = None,
    **meta: Any,
) -> None:
    """Adds an audit entry to the current transaction (committed with the change it describes)."""
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            meta={k: str(v) if isinstance(v, uuid.UUID) else v for k, v in meta.items()},
            ip_address=ip_address,
        )
    )
