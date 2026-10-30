import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Request, Response, status
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.core.redis import redis_client, revoked_session_key
from app.core.security import (
    ACCESS_COOKIE,
    CLIENT_TYPE_HEADER,
    CSRF_COOKIE,
    REFRESH_COOKIE,
    TOKEN_BODY_CLIENTS,
    create_access_token,
    decrypt_field,
    encrypt_field,
    hash_token,
    new_csrf_token,
    new_refresh_token,
    verify_password,
)
from app.models.enums import UserStatus
from app.models.user import AuthSession, User
from app.schemas.auth import TokenBundle
from app.utils.text import looks_like_email, normalize_email, normalize_phone

INVALID_CREDENTIALS = "The phone/email or password you entered is incorrect."
# Parallel requests (e.g. page prefetches) may refresh with the same token at once. For a short window
# the just-rotated token is answered with the same successor instead of being treated as theft.
REFRESH_GRACE_SECONDS = 30


@dataclass
class IssuedTokens:
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime

    def bundle(self) -> TokenBundle:
        return TokenBundle(
            access_token=self.access_token,
            access_expires_at=self.access_expires_at,
            refresh_token=self.refresh_token,
            refresh_expires_at=self.refresh_expires_at,
        )


def client_type(request: Request) -> str:
    value = request.headers.get(CLIENT_TYPE_HEADER, "browser").lower()
    return value if value in TOKEN_BODY_CLIENTS else "browser"


def _failure_key(identifier: str) -> str:
    return f"auth:failures:{identifier}"


async def find_user_by_identifier(db: AsyncSession, identifier: str) -> User | None:
    identifier = identifier.strip()
    if looks_like_email(identifier):
        stmt = select(User).where(User.email == normalize_email(identifier))
    else:
        phone = normalize_phone(identifier)
        stmt = select(User).where(or_(User.phone == phone, User.badge_number == identifier.upper()))
    return await db.scalar(stmt)


async def authenticate(db: AsyncSession, identifier: str, password: str) -> User:
    key = _failure_key(identifier.strip().lower())
    failures = int(await redis_client.get(key) or 0)
    if failures >= settings.login_max_failures:
        ttl = await redis_client.ttl(key)
        minutes = max(1, (ttl if ttl > 0 else settings.login_lockout_seconds) // 60)
        raise AppError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "account_locked",
            f"Too many failed attempts. Try again in {minutes} minute(s) or reset your password.",
        )

    user = await find_user_by_identifier(db, identifier)
    valid, new_hash = (False, None)
    if user is not None:
        valid, new_hash = verify_password(password, user.password_hash)

    if user is None or not valid:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, settings.login_lockout_seconds)
        await pipe.execute()
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_credentials", INVALID_CREDENTIALS)

    ensure_can_login(user)
    if new_hash:
        user.password_hash = new_hash
    await redis_client.delete(key)
    return user


def ensure_can_login(user: User) -> None:
    if user.status == UserStatus.SUSPENDED:
        raise AppError(
            status.HTTP_403_FORBIDDEN,
            "account_suspended",
            "This account has been suspended. Contact the Park Mandu help desk.",
        )


async def issue_session(db: AsyncSession, user: User, request: Request) -> IssuedTokens:
    now = datetime.now(UTC)
    refresh_token = new_refresh_token()
    session = AuthSession(
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        client_type=client_type(request),
        user_agent=(request.headers.get("User-Agent") or "")[:255] or None,
        ip_address=request.client.host if request.client else None,
        expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
        last_used_at=now,
    )
    db.add(session)
    user.last_login_at = now
    await db.flush()
    access, access_exp = create_access_token(user_id=user.id, role=user.role.value, session_id=session.id)
    return IssuedTokens(access, access_exp, refresh_token, session.expires_at)


def _grace_key(token_hash: str) -> str:
    return f"auth:grace:{token_hash}"


async def _grace_rotation(db: AsyncSession, token_hash: str, now: datetime) -> tuple[User, IssuedTokens] | None:
    cached = await redis_client.get(_grace_key(token_hash))
    if not cached:
        return None
    session_id, encrypted = cached.split(":", 1)
    successor = decrypt_field(encrypted)
    session = await db.get(AuthSession, uuid.UUID(session_id))
    if successor is None or session is None or session.revoked_at is not None or session.expires_at <= now:
        return None
    if session.token_hash != hash_token(successor):
        return None  # rotated again since; fall through to reuse detection
    user = await db.get(User, session.user_id)
    if user is None:
        return None
    ensure_can_login(user)
    access, access_exp = create_access_token(user_id=user.id, role=user.role.value, session_id=session.id)
    return user, IssuedTokens(access, access_exp, successor, session.expires_at)


async def rotate_session(db: AsyncSession, refresh_token: str) -> tuple[User, IssuedTokens]:
    token_hash = hash_token(refresh_token)
    now = datetime.now(UTC)
    raced = await _grace_rotation(db, token_hash, now)
    if raced is not None:
        return raced
    session = await db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash))

    if session is None:
        # A rotated-out token being replayed means it leaked — end that whole session family.
        reused = await db.scalar(select(AuthSession).where(AuthSession.previous_token_hash == token_hash))
        if reused is not None and reused.revoked_at is None:
            reused.revoked_at = now
            await db.commit()
            await _mark_revoked(str(reused.id))
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_refresh", "Please sign in again.")

    if session.revoked_at is not None or session.expires_at <= now:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_refresh", "Please sign in again.")

    user = await db.get(User, session.user_id)
    if user is None:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_refresh", "Please sign in again.")
    ensure_can_login(user)

    new_token = new_refresh_token()
    session.previous_token_hash = token_hash
    session.token_hash = hash_token(new_token)
    session.last_used_at = now
    access, access_exp = create_access_token(user_id=user.id, role=user.role.value, session_id=session.id)
    await db.flush()
    await redis_client.set(_grace_key(token_hash), f"{session.id}:{encrypt_field(new_token)}", ex=REFRESH_GRACE_SECONDS)
    return user, IssuedTokens(access, access_exp, new_token, session.expires_at)


async def _mark_revoked(session_id: str) -> None:
    await redis_client.set(revoked_session_key(session_id), "1", ex=settings.access_token_ttl_minutes * 60 + 60)


async def revoke_session(db: AsyncSession, session_id: str) -> None:
    await db.execute(
        update(AuthSession)
        .where(AuthSession.id == uuid.UUID(session_id), AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await _mark_revoked(session_id)


async def revoke_all_sessions(db: AsyncSession, user: User, keep_session_id: str | None = None) -> None:
    ids = (
        await db.scalars(select(AuthSession.id).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)))
    ).all()
    for session_id in ids:
        if keep_session_id and str(session_id) == keep_session_id:
            continue
        await revoke_session(db, str(session_id))


def set_auth_cookies(response: Response, tokens: IssuedTokens) -> None:
    common = {
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "domain": settings.cookie_domain,
    }
    response.set_cookie(
        ACCESS_COOKIE,
        tokens.access_token,
        max_age=settings.access_token_ttl_minutes * 60,
        httponly=True,
        path="/",
        **common,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh_token,
        max_age=settings.refresh_token_ttl_days * 86400,
        httponly=True,
        path=f"{settings.api_prefix}/auth",
        **common,
    )
    # Readable by browser JS so it can be echoed in the X-CSRF-Token header.
    response.set_cookie(
        CSRF_COOKIE,
        new_csrf_token(),
        max_age=settings.refresh_token_ttl_days * 86400,
        httponly=False,
        path="/",
        **common,
    )


def clear_auth_cookies(response: Response) -> None:
    for name, path in (
        (ACCESS_COOKIE, "/"),
        (REFRESH_COOKIE, f"{settings.api_prefix}/auth"),
        (CSRF_COOKIE, "/"),
    ):
        response.delete_cookie(name, path=path, domain=settings.cookie_domain)
