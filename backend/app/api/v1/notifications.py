import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, status
from sqlalchemy import delete, func, select, update

from app.api.deps import CurrentUser, DbSession
from app.core.errors import not_found
from app.models.notification import DeviceToken, Notification
from app.schemas.common import MessageOut
from app.schemas.notification import DeviceRegister, NotificationFilters, NotificationOut, UnreadCount
from app.utils.pagination import Page, paginate

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=Page[NotificationOut])
async def list_notifications(
    filters: Annotated[NotificationFilters, Query()], user: CurrentUser, db: DbSession
) -> dict[str, Any]:
    stmt = select(Notification).where(Notification.user_id == user.id)
    if filters.unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc(), Notification.id)
    return await paginate(db, stmt, filters)


@router.get("/notifications/unread-count", response_model=UnreadCount)
async def unread_count(user: CurrentUser, db: DbSession) -> UnreadCount:
    count = await db.scalar(select(func.count()).where(Notification.user_id == user.id, Notification.read_at.is_(None)))
    return UnreadCount(unread=int(count or 0))


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Notification:
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise not_found("Notification")
    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        await db.commit()
    return notification


@router.post("/notifications/read-all", response_model=MessageOut)
async def mark_all_read(user: CurrentUser, db: DbSession) -> MessageOut:
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()
    return MessageOut(message="All notifications marked as read.")


@router.post("/devices", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def register_device(body: DeviceRegister, user: CurrentUser, db: DbSession) -> MessageOut:
    # A device token belongs to whoever signed in on that device most recently.
    await db.execute(delete(DeviceToken).where(DeviceToken.token == body.token))
    db.add(DeviceToken(user_id=user.id, token=body.token, platform=body.platform))
    await db.commit()
    return MessageOut(message="Device registered for notifications.")


@router.delete("/devices/{token}", response_model=MessageOut)
async def unregister_device(token: str, user: CurrentUser, db: DbSession) -> MessageOut:
    await db.execute(delete(DeviceToken).where(DeviceToken.token == token, DeviceToken.user_id == user.id))
    await db.commit()
    return MessageOut(message="Device removed.")
