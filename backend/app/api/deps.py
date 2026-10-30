import uuid
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import jwt
from fastapi import Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, forbidden
from app.core.redis import redis_client, revoked_session_key
from app.core.security import (
    ACCESS_COOKIE,
    CSRF_COOKIE,
    CSRF_HEADER,
    constant_time_equals,
    decode_access_token,
)
from app.db.session import get_db
from app.models.enums import UserRole, UserStatus
from app.models.user import User

DbSession = Annotated[AsyncSession, Depends(get_db)]

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _unauthorized(message: str = "Please sign in to continue.", code: str = "unauthorized") -> AppError:
    return AppError(status.HTTP_401_UNAUTHORIZED, code, message, headers={"WWW-Authenticate": "Bearer"})


def _extract_token(request: Request) -> tuple[str | None, bool]:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip(), False
    cookie = request.cookies.get(ACCESS_COOKIE)
    return cookie, cookie is not None


async def _resolve_user(request: Request, db: AsyncSession, *, required: bool) -> User | None:
    token, via_cookie = _extract_token(request)
    if not token:
        if required:
            raise _unauthorized()
        return None

    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("Your session has expired.", "token_expired") from exc
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Invalid session.", "invalid_token") from exc

    # Cookie-authenticated browsers must echo the CSRF cookie in a header (double-submit pattern).
    if via_cookie and request.method not in SAFE_METHODS:
        cookie_value = request.cookies.get(CSRF_COOKIE, "")
        header_value = request.headers.get(CSRF_HEADER, "")
        if not cookie_value or not header_value or not constant_time_equals(cookie_value, header_value):
            raise AppError(status.HTTP_403_FORBIDDEN, "csrf_failed", "Security check failed. Refresh and try again.")

    if await redis_client.exists(revoked_session_key(payload["sid"])):
        raise _unauthorized("Your session has ended. Please sign in again.", "session_revoked")

    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None:
        raise _unauthorized()
    if user.status == UserStatus.SUSPENDED:
        raise forbidden("This account has been suspended. Contact the Park Mandu help desk.")

    request.state.user = user
    request.state.session_id = payload["sid"]
    return user


async def get_current_user(request: Request, db: DbSession) -> User:
    user = await _resolve_user(request, db, required=True)
    assert user is not None
    return user


async def get_optional_user(request: Request, db: DbSession) -> User | None:
    return await _resolve_user(request, db, required=False)


def require_roles(*roles: UserRole) -> Callable[..., Coroutine[Any, Any, User]]:
    async def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise forbidden()
        return user

    return dependency


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
PublicUser = Annotated[User, Depends(require_roles(UserRole.PUBLIC))]
PoliceUser = Annotated[User, Depends(require_roles(UserRole.POLICE, UserRole.ADMIN))]
AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN))]


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
