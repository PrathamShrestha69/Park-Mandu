from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import PhoneNumber, StrongPassword, UserOut


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=255, description="Email address or phone number")
    password: str = Field(min_length=1, max_length=128)


class OtpRequest(BaseModel):
    phone: PhoneNumber


class OtpVerifyRequest(BaseModel):
    phone: PhoneNumber
    code: str = Field(pattern=r"^\d{6}$")


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr | None = None
    phone: PhoneNumber
    password: StrongPassword


class RefreshRequest(BaseModel):
    refresh_token: str | None = Field(None, max_length=255)


class ForgotPasswordRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=255)


class ResetPasswordRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=255)
    code: str = Field(pattern=r"^\d{6}$")
    new_password: StrongPassword


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: StrongPassword


class TokenBundle(BaseModel):
    token_type: str = "bearer"
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime


class AuthResponse(BaseModel):
    user: UserOut
    tokens: TokenBundle | None = None


class CodeSent(BaseModel):
    message: str
    expires_in: int
    dev_code: str | None = None
