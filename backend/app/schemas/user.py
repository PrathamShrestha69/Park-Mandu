import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, EmailStr, Field

from app.models.enums import UserRole, UserStatus
from app.schemas.common import ORMModel
from app.utils.pagination import PageParams
from app.utils.text import normalize_phone

PASSWORD_RULE = "Use at least 8 characters with a mix of letters and numbers."


def validate_password_strength(value: str) -> str:
    if len(value) < 8 or not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError(PASSWORD_RULE)
    return value


def validate_phone(value: str) -> str:
    phone = normalize_phone(value)
    if not re.fullmatch(r"\+?\d{7,15}", phone):
        raise ValueError("Enter a valid phone number, e.g. 98XXXXXXXX.")
    return phone


PhoneNumber = Annotated[str, AfterValidator(validate_phone)]
StrongPassword = Annotated[str, Field(max_length=128), AfterValidator(validate_password_strength)]


class UserOut(ORMModel):
    id: uuid.UUID
    full_name: str
    initials: str
    email: str | None
    phone: str | None
    role: UserRole
    status: UserStatus
    is_verified: bool
    designation: str | None
    badge_number: str | None
    unit: str | None
    on_duty: bool
    created_at: datetime
    last_login_at: datetime | None


class UserFilters(PageParams):
    q: str | None = Field(None, max_length=80)
    role: UserRole | None = None
    status: UserStatus | None = None
    sort: Literal["newest", "oldest", "name"] = "newest"


class StaffCreate(ORMModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: PhoneNumber
    password: StrongPassword
    role: Literal[UserRole.POLICE, UserRole.ADMIN]
    designation: str | None = Field(None, max_length=120)
    badge_number: str | None = Field(None, max_length=20)
    unit: str | None = Field(None, max_length=120)


class UserUpdate(ORMModel):
    status: UserStatus | None = None
    role: UserRole | None = None
    designation: str | None = Field(None, max_length=120)
    unit: str | None = Field(None, max_length=120)


class ProfileUpdate(ORMModel):
    full_name: str | None = Field(None, min_length=2, max_length=120)
    email: EmailStr | None = None


class DutyUpdate(ORMModel):
    on_duty: bool
