import hashlib
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, CurrentUser, DbSession, client_ip
from app.core.errors import AppError, not_found
from app.core.realtime import emit, role_room
from app.core.redis import redis_client
from app.models.enums import SuggestionStatus, UserRole
from app.models.suggestion import Suggestion
from app.schemas.common import MessageOut
from app.schemas.suggestion import (
    SuggestionAdminOut,
    SuggestionCounts,
    SuggestionCreate,
    SuggestionFilters,
    SuggestionOut,
    SuggestionUpdate,
)
from app.services import audit
from app.utils.pagination import Page, paginate
from app.utils.text import escape_like

router = APIRouter(tags=["suggestions"])

PER_HOUR_LIMIT = 5
PER_DAY_LIMIT = 15
DUPLICATE_WINDOW = timedelta(days=7)
THANKS = "Thank you! Your suggestion has been sent to the Park Mandu team."


def _fingerprint(message: str) -> str:
    return hashlib.sha256(re.sub(r"\W+", "", message.lower()).encode()).hexdigest()


async def _within_limits(user_id: uuid.UUID) -> bool:
    """Counts submissions per person in Redis. False once the hourly or daily allowance is used up."""
    hour, day = f"suggestions:hour:{user_id}", f"suggestions:day:{user_id}"
    pipe = redis_client.pipeline()
    pipe.incr(hour)
    pipe.expire(hour, 3600, nx=True)
    pipe.incr(day)
    pipe.expire(day, 86400, nx=True)
    hour_count, _, day_count, _ = await pipe.execute()
    return hour_count <= PER_HOUR_LIMIT and day_count <= PER_DAY_LIMIT


@router.post(
    "/suggestions",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
    summary="Send a suggestion or feedback",
)
async def create_suggestion(body: SuggestionCreate, user: CurrentUser, db: DbSession) -> MessageOut:
    if body.website:  # honeypot filled in: pretend success so bots learn nothing
        return MessageOut(message=THANKS)
    if not await _within_limits(user.id):
        raise AppError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "suggestion_rate_limited",
            "You have sent several suggestions recently. Please wait a while before sending another.",
        )
    fingerprint = _fingerprint(body.message)
    duplicate = await db.scalar(
        select(Suggestion.id).where(
            Suggestion.user_id == user.id,
            Suggestion.fingerprint == fingerprint,
            Suggestion.created_at >= datetime.now(UTC) - DUPLICATE_WINDOW,
        )
    )
    if duplicate:
        raise AppError(
            status.HTTP_409_CONFLICT, "duplicate_suggestion", "You have already sent this suggestion. Thank you!"
        )
    suggestion = Suggestion(user_id=user.id, category=body.category, message=body.message, fingerprint=fingerprint)
    db.add(suggestion)
    await db.commit()
    await emit(
        "suggestion:new",
        {"suggestion_id": str(suggestion.id), "category": body.category.value, "preview": body.message[:120]},
        role_room(UserRole.ADMIN.value),
    )
    return MessageOut(message=THANKS)


@router.get("/suggestions/mine", response_model=list[SuggestionOut], summary="Suggestions you have sent")
async def my_suggestions(user: CurrentUser, db: DbSession) -> list[Suggestion]:
    rows = await db.scalars(
        select(Suggestion).where(Suggestion.user_id == user.id).order_by(Suggestion.created_at.desc()).limit(20)
    )
    return list(rows)


# --------------------------------------------------------------------------- administration


def _admin_out(suggestion: Suggestion) -> SuggestionAdminOut:
    out = SuggestionAdminOut.model_validate(suggestion)
    if suggestion.user is not None:
        out.author_name = suggestion.user.full_name
        out.author_contact = suggestion.user.email or suggestion.user.phone
    return out


def _query() -> Any:
    return select(Suggestion).options(selectinload(Suggestion.user))


@router.get("/admin/suggestions", response_model=Page[SuggestionAdminOut], tags=["admin"])
async def list_suggestions(
    filters: Annotated[SuggestionFilters, Query()], _: AdminUser, db: DbSession
) -> dict[str, Any]:
    stmt = _query()
    if filters.status:
        stmt = stmt.where(Suggestion.status == filters.status)
    if filters.category:
        stmt = stmt.where(Suggestion.category == filters.category)
    if filters.q:
        stmt = stmt.where(Suggestion.message.ilike(f"%{escape_like(filters.q.strip())}%", escape="\\"))
    order = Suggestion.created_at.asc() if filters.sort == "oldest" else Suggestion.created_at.desc()
    return await paginate(db, stmt.order_by(order, Suggestion.id), filters, transform=_admin_out)


@router.get("/admin/suggestions/counts", response_model=SuggestionCounts, tags=["admin"])
async def suggestion_counts(_: AdminUser, db: DbSession) -> SuggestionCounts:
    rows = dict((await db.execute(select(Suggestion.status, func.count()).group_by(Suggestion.status))).all())
    return SuggestionCounts(
        total=sum(rows.values()),
        new=rows.get(SuggestionStatus.NEW, 0),
        reviewed=rows.get(SuggestionStatus.REVIEWED, 0),
        resolved=rows.get(SuggestionStatus.RESOLVED, 0),
        archived=rows.get(SuggestionStatus.ARCHIVED, 0),
    )


@router.patch("/admin/suggestions/{suggestion_id}", response_model=SuggestionAdminOut, tags=["admin"])
async def update_suggestion(
    request: Request, suggestion_id: uuid.UUID, body: SuggestionUpdate, admin: AdminUser, db: DbSession
) -> SuggestionAdminOut:
    suggestion = await db.scalar(_query().where(Suggestion.id == suggestion_id).with_for_update(of=Suggestion))
    if suggestion is None:
        raise not_found("Suggestion")
    if body.status is not None:
        suggestion.status = body.status
    if body.admin_note is not None:
        suggestion.admin_note = body.admin_note.strip() or None
    audit.record(
        db,
        actor=admin,
        action="suggestion.updated",
        entity_type="suggestion",
        entity_id=suggestion.id,
        ip_address=client_ip(request),
        status=suggestion.status.value,
    )
    await db.commit()
    fresh = await db.scalar(_query().where(Suggestion.id == suggestion_id).execution_options(populate_existing=True))
    assert fresh is not None
    return _admin_out(fresh)


@router.delete("/admin/suggestions/{suggestion_id}", response_model=MessageOut, tags=["admin"])
async def delete_suggestion(request: Request, suggestion_id: uuid.UUID, admin: AdminUser, db: DbSession) -> MessageOut:
    suggestion = await db.get(Suggestion, suggestion_id)
    if suggestion is None:
        raise not_found("Suggestion")
    await db.delete(suggestion)
    audit.record(
        db,
        actor=admin,
        action="suggestion.deleted",
        entity_type="suggestion",
        entity_id=suggestion_id,
        ip_address=client_ip(request),
    )
    await db.commit()
    return MessageOut(message="Suggestion deleted.")
