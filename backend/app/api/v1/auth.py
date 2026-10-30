from fastapi import APIRouter, Request, Response, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, client_ip
from app.core.config import settings
from app.core.errors import AppError
from app.core.rate_limit import limiter
from app.core.redis import redis_client
from app.core.security import (
    REFRESH_COOKIE,
    TOKEN_BODY_CLIENTS,
    constant_time_equals,
    decode_access_token,
    hash_password,
    hash_token,
    new_numeric_code,
    verify_password,
)
from app.models.enums import UserRole
from app.models.user import AuthSession, User
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    CodeSent,
    ForgotPasswordRequest,
    LoginRequest,
    OtpRequest,
    OtpVerifyRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
)
from app.schemas.common import MessageOut
from app.schemas.user import ProfileUpdate, UserOut
from app.services import audit
from app.services.auth import (
    IssuedTokens,
    authenticate,
    clear_auth_cookies,
    client_type,
    ensure_can_login,
    find_user_by_identifier,
    issue_session,
    revoke_all_sessions,
    revoke_session,
    rotate_session,
    set_auth_cookies,
)
from app.utils.text import normalize_email
from app.worker.tasks import send_sms

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_CODE_ATTEMPTS = 5


def _respond(request: Request, response: Response, user: User, tokens: IssuedTokens) -> AuthResponse:
    """Browsers receive httpOnly cookies; mobile apps and the web server receive tokens in the body."""
    if client_type(request) in TOKEN_BODY_CLIENTS:
        return AuthResponse(user=UserOut.model_validate(user), tokens=tokens.bundle())
    set_auth_cookies(response, tokens)
    return AuthResponse(user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthResponse)
@limiter.limit("10/minute")
async def login(request: Request, response: Response, body: LoginRequest, db: DbSession) -> AuthResponse:
    user = await authenticate(db, body.identifier, body.password)
    tokens = await issue_session(db, user, request)
    audit.record(
        db, actor=user, action="auth.login", entity_type="user", entity_id=user.id, ip_address=client_ip(request)
    )
    await db.commit()
    return _respond(request, response, user, tokens)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, response: Response, body: RegisterRequest, db: DbSession) -> AuthResponse:
    email = normalize_email(body.email) if body.email else None
    fields: dict[str, str] = {}
    if await db.scalar(select(User.id).where(User.phone == body.phone)):
        fields["phone"] = "An account with this phone number already exists."
    if email and await db.scalar(select(User.id).where(User.email == email)):
        fields["email"] = "An account with this email already exists."
    if fields:
        raise AppError(status.HTTP_409_CONFLICT, "account_exists", "You may already have an account.", fields)

    user = User(
        full_name=body.full_name.strip(),
        email=email,
        phone=body.phone,
        password_hash=hash_password(body.password),
        role=UserRole.PUBLIC,
        designation="Public user",
    )
    db.add(user)
    await db.flush()
    tokens = await issue_session(db, user, request)
    audit.record(
        db, actor=user, action="auth.register", entity_type="user", entity_id=user.id, ip_address=client_ip(request)
    )
    await db.commit()
    return _respond(request, response, user, tokens)


@router.post("/otp/request", response_model=CodeSent)
@limiter.limit("3/minute")
async def request_otp(request: Request, body: OtpRequest, db: DbSession) -> CodeSent:
    user = await db.scalar(select(User).where(User.phone == body.phone))
    dev_code: str | None = None
    if user is not None:
        code = new_numeric_code()
        key = f"auth:otp:{body.phone}"
        await redis_client.delete(f"{key}:attempts")
        await redis_client.set(key, hash_token(code), ex=settings.otp_ttl_seconds)
        send_sms.delay(body.phone, f"Your Park Mandu sign-in code is {code}. It expires in 5 minutes.")
        dev_code = code if settings.expose_dev_codes else None
    # Same response whether or not the number is registered, to avoid account enumeration.
    return CodeSent(
        message="If this number is registered, a one-time code has been sent by SMS.",
        expires_in=settings.otp_ttl_seconds,
        dev_code=dev_code,
    )


async def _consume_code(key: str, code: str) -> bool:
    stored = await redis_client.get(key)
    if stored is None:
        return False
    attempts = await redis_client.incr(f"{key}:attempts")
    await redis_client.expire(f"{key}:attempts", settings.otp_ttl_seconds)
    if attempts > MAX_CODE_ATTEMPTS:
        await redis_client.delete(key)
        return False
    if not constant_time_equals(stored, hash_token(code)):
        return False
    await redis_client.delete(key, f"{key}:attempts")
    return True


@router.post("/otp/verify", response_model=AuthResponse)
@limiter.limit("10/minute")
async def verify_otp(request: Request, response: Response, body: OtpVerifyRequest, db: DbSession) -> AuthResponse:
    if not await _consume_code(f"auth:otp:{body.phone}", body.code):
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_code", "That code is incorrect or has expired.")
    user = await db.scalar(select(User).where(User.phone == body.phone))
    if user is None:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_code", "That code is incorrect or has expired.")
    ensure_can_login(user)
    tokens = await issue_session(db, user, request)
    audit.record(
        db, actor=user, action="auth.login_otp", entity_type="user", entity_id=user.id, ip_address=client_ip(request)
    )
    await db.commit()
    return _respond(request, response, user, tokens)


@router.post("/refresh", response_model=AuthResponse)
@limiter.limit("30/minute")
async def refresh(
    request: Request, response: Response, db: DbSession, body: RefreshRequest | None = None
) -> AuthResponse:
    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_refresh", "Please sign in again.")
    try:
        user, tokens = await rotate_session(db, token)
    except AppError:
        clear_auth_cookies(response)
        raise
    await db.commit()
    return _respond(request, response, user, tokens)


@router.post("/logout", response_model=MessageOut)
async def logout(request: Request, response: Response, db: DbSession, body: RefreshRequest | None = None) -> MessageOut:
    session_id: str | None = None
    header = request.headers.get("Authorization", "")
    access = header[7:] if header.lower().startswith("bearer ") else request.cookies.get("pm_access")
    if access:
        try:
            session_id = decode_access_token(access)["sid"]
        except Exception:  # an expired access token still lets the refresh token end the session
            session_id = None
    refresh_token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if session_id is None and refresh_token:
        session_id_value = await db.scalar(
            select(AuthSession.id).where(AuthSession.token_hash == hash_token(refresh_token))
        )
        session_id = str(session_id_value) if session_id_value else None
    if session_id:
        await revoke_session(db, session_id)
        await db.commit()
    clear_auth_cookies(response)
    return MessageOut(message="You have been signed out.")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(body: ProfileUpdate, user: CurrentUser, db: DbSession) -> User:
    if body.email is not None:
        email = normalize_email(body.email)
        taken = await db.scalar(select(User.id).where(User.email == email, User.id != user.id))
        if taken:
            raise AppError(
                status.HTTP_409_CONFLICT,
                "email_taken",
                "That email is already in use.",
                {"email": "That email is already in use."},
            )
        user.email = email
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/password/change", response_model=MessageOut)
async def change_password(
    request: Request, body: ChangePasswordRequest, user: CurrentUser, db: DbSession
) -> MessageOut:
    valid, _ = verify_password(body.current_password, user.password_hash)
    if not valid:
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            "invalid_password",
            "Your current password is incorrect.",
            {"current_password": "Your current password is incorrect."},
        )
    user.password_hash = hash_password(body.new_password)
    await revoke_all_sessions(db, user, keep_session_id=getattr(request.state, "session_id", None))
    audit.record(
        db,
        actor=user,
        action="auth.password_changed",
        entity_type="user",
        entity_id=user.id,
        ip_address=client_ip(request),
    )
    await db.commit()
    return MessageOut(message="Password updated. Please sign in again on your other devices.")


@router.post("/password/forgot", response_model=CodeSent)
@limiter.limit("3/minute")
async def forgot_password(request: Request, body: ForgotPasswordRequest, db: DbSession) -> CodeSent:
    user = await find_user_by_identifier(db, body.identifier)
    dev_code: str | None = None
    if user is not None and user.phone:
        code = new_numeric_code()
        await redis_client.delete(f"auth:reset:{user.id}:attempts")
        await redis_client.set(f"auth:reset:{user.id}", hash_token(code), ex=settings.password_reset_ttl_seconds)
        send_sms.delay(user.phone, f"Your Park Mandu password reset code is {code}. It expires in 30 minutes.")
        dev_code = code if settings.expose_dev_codes else None
    return CodeSent(
        message="If an account matches, we have sent a reset code to its registered phone number.",
        expires_in=settings.password_reset_ttl_seconds,
        dev_code=dev_code,
    )


@router.post("/password/reset", response_model=MessageOut)
@limiter.limit("10/minute")
async def reset_password(request: Request, body: ResetPasswordRequest, db: DbSession) -> MessageOut:
    user = await find_user_by_identifier(db, body.identifier)
    if user is None or not await _consume_code(f"auth:reset:{user.id}", body.code):
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            "invalid_code",
            "That code is incorrect or has expired.",
            {"code": "That code is incorrect or has expired."},
        )
    user.password_hash = hash_password(body.new_password)
    await revoke_all_sessions(db, user)
    audit.record(
        db,
        actor=user,
        action="auth.password_reset",
        entity_type="user",
        entity_id=user.id,
        ip_address=client_ip(request),
    )
    await db.commit()
    await redis_client.delete(f"auth:failures:{body.identifier.strip().lower()}")
    return MessageOut(message="Your password has been reset. You can now sign in.")
