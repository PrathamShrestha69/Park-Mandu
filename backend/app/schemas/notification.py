import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import NotificationKind, NotificationTone
from app.schemas.common import ORMModel
from app.utils.pagination import PageParams


class NotificationOut(ORMModel):
    id: uuid.UUID
    kind: NotificationKind
    tone: NotificationTone
    title: str
    body: str
    entity_type: str | None
    entity_id: uuid.UUID | None
    read_at: datetime | None
    created_at: datetime


class NotificationFilters(PageParams):
    unread_only: bool = False


class UnreadCount(BaseModel):
    unread: int


class DeviceRegister(BaseModel):
    token: str = Field(min_length=10, max_length=255, pattern=r"^(Exponent|Expo)PushToken\[.+\]$")
    platform: Literal["ios", "android", "web"]
