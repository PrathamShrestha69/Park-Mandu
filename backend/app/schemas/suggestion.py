import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.enums import SuggestionCategory, SuggestionStatus
from app.schemas.common import ORMModel
from app.utils.pagination import PageParams

MIN_LENGTH = 10
MAX_LENGTH = 1500
MAX_LINKS = 1
LINK_PATTERN = re.compile(r"(https?://|www\.)", re.IGNORECASE)


class SuggestionCreate(BaseModel):
    category: SuggestionCategory = SuggestionCategory.OTHER
    message: str = Field(max_length=4000)
    # Honeypot: hidden from people, filled in by bots. Real submissions leave it empty.
    website: str | None = Field(None, max_length=200)

    @field_validator("message")
    @classmethod
    def _meaningful(cls, value: str) -> str:
        text = re.sub(r"\s+", " ", value).strip()
        if len(text) < MIN_LENGTH:
            raise ValueError(f"Please write at least {MIN_LENGTH} characters so we can understand your suggestion.")
        if len(text) > MAX_LENGTH:
            raise ValueError(f"Please keep your suggestion under {MAX_LENGTH} characters.")
        letters = re.sub(r"[\W\d_]+", "", text)
        if len(letters) < MIN_LENGTH // 2 or len(set(letters.lower())) < 4:
            raise ValueError("Please describe your suggestion in words.")
        if len(LINK_PATTERN.findall(text)) > MAX_LINKS:
            raise ValueError("Please remove the extra links from your suggestion.")
        return text


class SuggestionOut(ORMModel):
    id: uuid.UUID
    category: SuggestionCategory
    message: str
    status: SuggestionStatus
    created_at: datetime


class SuggestionAdminOut(SuggestionOut):
    admin_note: str | None
    author_name: str | None = None
    author_contact: str | None = None
    updated_at: datetime


class SuggestionFilters(PageParams):
    status: SuggestionStatus | None = None
    category: SuggestionCategory | None = None
    q: str | None = Field(None, max_length=80)
    sort: Literal["newest", "oldest"] = "newest"


class SuggestionCounts(BaseModel):
    total: int
    new: int
    reviewed: int
    resolved: int
    archived: int


class SuggestionUpdate(BaseModel):
    status: SuggestionStatus | None = None
    admin_note: str | None = Field(None, max_length=500)
