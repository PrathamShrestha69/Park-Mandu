import uuid

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import SuggestionCategory, SuggestionStatus
from app.models.user import User


class Suggestion(UUIDPrimaryKey, Timestamps, Base):
    """Feedback from the public, reviewed by administrators."""

    __tablename__ = "suggestions"
    __table_args__ = (Index("ix_suggestions_status_created", "status", "created_at"),)

    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    category: Mapped[SuggestionCategory] = mapped_column(str_enum(SuggestionCategory))
    message: Mapped[str] = mapped_column(Text)
    # Hash of the normalised message; the same person repeating a suggestion is refused.
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[SuggestionStatus] = mapped_column(str_enum(SuggestionStatus), default=SuggestionStatus.NEW)
    admin_note: Mapped[str | None] = mapped_column(String(500))

    user: Mapped[User | None] = relationship(lazy="raise")
