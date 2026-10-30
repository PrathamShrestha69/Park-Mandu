import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from cryptography.fernet import Fernet, InvalidToken
from pwdlib import PasswordHash

from app.core.config import settings

_password_hash = PasswordHash.recommended()  # Argon2id
_fernet = Fernet(settings.field_encryption_key.encode())

ACCESS_COOKIE = "pm_access"
REFRESH_COOKIE = "pm_refresh"
CSRF_COOKIE = "pm_csrf"
CSRF_HEADER = "X-CSRF-Token"
CLIENT_TYPE_HEADER = "X-Client-Type"
# Clients that keep tokens themselves (mobile secure storage, the Next.js server). Browsers get cookies.
TOKEN_BODY_CLIENTS = {"mobile", "web-server"}


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> tuple[bool, str | None]:
    """Returns (valid, updated_hash) — updated_hash is set when parameters should be upgraded."""
    return _password_hash.verify_and_update(password, password_hash)


def create_access_token(*, user_id: uuid.UUID, role: str, session_id: uuid.UUID) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.access_token_ttl_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "sid": str(session_id),
        "typ": "access",
        "iat": now,
        "exp": expires_at,
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm), expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(
        token,
        settings.secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "sid", "exp", "typ"]},
    )
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("Wrong token type")
    return payload


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(24)


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def new_numeric_code(length: int = 6) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(length))


def encrypt_field(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt_field(value: str) -> str | None:
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        return None
