import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, DbSession, client_ip
from app.api.v1.applications import detail_response, load_application
from app.core.errors import AppError, conflict, not_found
from app.core.redis import redis_client
from app.core.security import hash_password
from app.models.application import ApplicationEvent, ParkingApplication
from app.models.enums import (
    OPEN_ALERT_STATUSES,
    PENDING_APPLICATION_STATUSES,
    AlertSeverity,
    ApplicationEventKind,
    ApplicationStatus,
    CameraStatus,
    IncidentStatus,
    NotificationKind,
    NotificationTone,
    ParkingCategory,
    ParkingStatus,
    UserRole,
)
from app.models.monitoring import Alert, Camera, Incident
from app.models.notification import AuditLog
from app.models.parking import ParkingLocation
from app.models.user import User
from app.schemas.application import (
    ApplicationDetail,
    ApplicationFilters,
    ApplicationSummary,
    DecisionRequest,
    StatusCounts,
)
from app.schemas.monitoring import VIOLATION_LABELS
from app.schemas.parking import MapMarker
from app.schemas.stats import (
    ActivityPoint,
    AdminMapOut,
    AreaCount,
    ChartStats,
    DashboardStats,
    MonthPoint,
    OutcomeSlice,
    OverviewStats,
)
from app.schemas.user import StaffCreate, UserFilters, UserOut, UserUpdate
from app.services import applications as app_service
from app.services import audit
from app.services import parking as parking_service
from app.services.auth import revoke_all_sessions
from app.utils.pagination import Page, PageParams, paginate
from app.utils.text import escape_like, normalize_email
from app.worker.tasks import notify

router = APIRouter(prefix="/admin", tags=["admin"])

STATS_CACHE_KEY = "cache:admin:dashboard"
STATS_TTL_SECONDS = 60


async def invalidate_stats() -> None:
    await redis_client.delete(STATS_CACHE_KEY)


# --------------------------------------------------------------------------- applications


@router.get("/applications", response_model=Page[ApplicationSummary])
async def list_applications(
    filters: Annotated[ApplicationFilters, Query()], _: AdminUser, db: DbSession
) -> dict[str, Any]:
    stmt = app_service.with_relations(select(ParkingApplication)).join(User, User.id == ParkingApplication.applicant_id)
    if filters.status == "pending" or filters.status is None:
        statuses = PENDING_APPLICATION_STATUSES if filters.status == "pending" else None
        stmt = stmt.where(
            ParkingApplication.status.in_(statuses)
            if statuses
            else ParkingApplication.status != ApplicationStatus.DRAFT
        )
    else:
        stmt = stmt.where(ParkingApplication.status == filters.status)
    if filters.q:
        pattern = f"%{escape_like(filters.q.strip())}%"
        stmt = stmt.where(
            or_(
                ParkingApplication.reference.ilike(pattern, escape="\\"),
                ParkingApplication.property_name.ilike(pattern, escape="\\"),
                ParkingApplication.address.ilike(pattern, escape="\\"),
                User.full_name.ilike(pattern, escape="\\"),
            )
        )
    if filters.area:
        stmt = stmt.where(ParkingApplication.area == filters.area)
    if filters.submitted_from:
        stmt = stmt.where(ParkingApplication.submitted_at >= datetime.combine(filters.submitted_from, time.min, UTC))
    if filters.submitted_to:
        stmt = stmt.where(
            ParkingApplication.submitted_at < datetime.combine(filters.submitted_to + timedelta(days=1), time.min, UTC)
        )
    order = {
        "newest": ParkingApplication.submitted_at.desc().nulls_last(),
        "oldest": ParkingApplication.submitted_at.asc().nulls_last(),
        "capacity": ParkingApplication.capacity.desc().nulls_last(),
    }[filters.sort]
    stmt = stmt.order_by(order, ParkingApplication.id)
    return await paginate(db, stmt, filters, transform=app_service.to_summary)


@router.get("/applications/counts", response_model=StatusCounts)
async def application_counts(_: AdminUser, db: DbSession) -> StatusCounts:
    rows = (await db.execute(select(ParkingApplication.status, func.count()).group_by(ParkingApplication.status))).all()
    counts = {row[0]: row[1] for row in rows}
    return StatusCounts(
        total=sum(v for k, v in counts.items() if k != ApplicationStatus.DRAFT),
        draft=counts.get(ApplicationStatus.DRAFT, 0),
        pending=sum(counts.get(s, 0) for s in PENDING_APPLICATION_STATUSES),
        approved=counts.get(ApplicationStatus.APPROVED, 0),
        rejected=counts.get(ApplicationStatus.REJECTED, 0),
        changes_requested=counts.get(ApplicationStatus.CHANGES_REQUESTED, 0),
    )


@router.get("/applications/{application_id}", response_model=ApplicationDetail)
async def get_application(application_id: uuid.UUID, admin: AdminUser, db: DbSession) -> ApplicationDetail:
    app = await load_application(db, application_id, admin)
    if app.status == ApplicationStatus.DRAFT:
        raise not_found("Application")
    return await detail_response(db, app)


@router.post("/applications/{application_id}/start-review", response_model=ApplicationDetail)
async def start_review(
    request: Request, application_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> ApplicationDetail:
    app = await load_application(db, application_id, admin)
    if app.status != ApplicationStatus.SUBMITTED:
        raise conflict("Only newly submitted applications can be moved into review.", "invalid_transition")
    app.status = ApplicationStatus.UNDER_REVIEW
    app.reviewer_id = admin.id
    db.add(
        ApplicationEvent(
            application_id=app.id,
            kind=ApplicationEventKind.REVIEW_STARTED,
            message="Your property and documents are being assessed.",
            actor_id=admin.id,
        )
    )
    audit.record(
        db,
        actor=admin,
        action="application.review_started",
        entity_type="application",
        entity_id=app.id,
        ip_address=client_ip(request),
    )
    await db.commit()
    await invalidate_stats()
    notify(
        app.applicant_id,
        NotificationKind.APPLICATION_UNDER_REVIEW,
        NotificationTone.WARNING,
        "Your parking application is under review.",
        f"Government review has started for reference {app.reference}.",
        "application",
        app.id,
    )
    return await detail_response(db, await load_application(db, application_id, admin))


DECISIONS: dict[str, tuple[ApplicationStatus, ApplicationEventKind, NotificationKind, NotificationTone, str]] = {
    "approve": (
        ApplicationStatus.APPROVED,
        ApplicationEventKind.APPROVED,
        NotificationKind.APPLICATION_APPROVED,
        NotificationTone.SUCCESS,
        "Your parking location has been approved.",
    ),
    "reject": (
        ApplicationStatus.REJECTED,
        ApplicationEventKind.REJECTED,
        NotificationKind.APPLICATION_REJECTED,
        NotificationTone.DANGER,
        "Your parking application was not approved.",
    ),
    "request_changes": (
        ApplicationStatus.CHANGES_REQUESTED,
        ApplicationEventKind.CHANGES_REQUESTED,
        NotificationKind.APPLICATION_CHANGES,
        NotificationTone.DANGER,
        "Your parking application needs changes.",
    ),
    "request_documents": (
        ApplicationStatus.CHANGES_REQUESTED,
        ApplicationEventKind.DOCUMENTS_REQUESTED,
        NotificationKind.DOCUMENTS_REQUIRED,
        NotificationTone.DANGER,
        "Additional documents are required.",
    ),
}


@router.post("/applications/{application_id}/decision", response_model=ApplicationDetail)
async def decide(
    request: Request, application_id: uuid.UUID, body: DecisionRequest, admin: AdminUser, db: DbSession
) -> ApplicationDetail:
    app = await load_application(db, application_id, admin)
    if app.status not in PENDING_APPLICATION_STATUSES:
        raise conflict("A decision has already been recorded for this application.", "invalid_transition")

    new_status, event_kind, notice_kind, tone, title = DECISIONS[body.decision]
    feedback = (body.feedback or "").strip() or None
    now = datetime.now(UTC)
    app.status = new_status
    app.reviewer_id = admin.id
    app.feedback = feedback
    app.decided_at = now if new_status in (ApplicationStatus.APPROVED, ApplicationStatus.REJECTED) else None

    if new_status == ApplicationStatus.APPROVED:
        db.add(
            ParkingLocation(
                name=app.property_name,
                address=app.address,
                area=app.area or "Kathmandu",
                latitude=app.latitude,
                longitude=app.longitude,
                category=ParkingCategory.PRIVATE,
                parking_type=app.parking_type,
                capacity=app.capacity,
                available_spaces=app.capacity,
                land_size_sqm=app.land_size_sqm,
                opens_at=app.opens_at,
                closes_at=app.closes_at,
                available_days=app.available_days,
                pricing_mode=app.pricing_mode,
                price_per_hour=app.price_per_hour,
                managed_by=app.owner_name,
                contact_phone=app.owner_phone,
                status=ParkingStatus.OPEN,
                owner_id=app.applicant_id,
                application_id=app.id,
            )
        )
        body_text = f"{app.property_name} is approved and now visible to the public on the Park Mandu map."
    else:
        body_text = feedback or ""

    db.add(
        ApplicationEvent(
            application_id=app.id, kind=event_kind, message=feedback or "Application approved.", actor_id=admin.id
        )
    )
    audit.record(
        db,
        actor=admin,
        action=f"application.{body.decision}",
        entity_type="application",
        entity_id=app.id,
        ip_address=client_ip(request),
        reference=app.reference,
        feedback=feedback,
    )
    await db.commit()
    await invalidate_stats()
    notify(app.applicant_id, notice_kind, tone, title, body_text, "application", app.id)
    return await detail_response(db, await load_application(db, application_id, admin))


# --------------------------------------------------------------------------- statistics


def _month_starts(count: int) -> list[date]:
    today = datetime.now(UTC).date().replace(day=1)
    months = []
    for i in range(count - 1, -1, -1):
        year, month = today.year, today.month - i
        while month <= 0:
            month += 12
            year -= 1
        months.append(date(year, month, 1))
    return months


async def _compute_stats(db: DbSession) -> DashboardStats:
    now = datetime.now(UTC)
    month_start = datetime.combine(now.date().replace(day=1), time.min, UTC)

    async def count(stmt: Any) -> int:
        return int(await db.scalar(stmt) or 0)

    app_counts = dict(
        (await db.execute(select(ParkingApplication.status, func.count()).group_by(ParkingApplication.status))).all()
    )
    camera_counts = dict((await db.execute(select(Camera.status, func.count()).group_by(Camera.status))).all())

    overview = OverviewStats(
        registered_parkings=await count(select(func.count()).where(ParkingLocation.is_published.is_(True))),
        registered_this_month=await count(select(func.count()).where(ParkingLocation.created_at >= month_start)),
        pending_applications=sum(app_counts.get(s, 0) for s in PENDING_APPLICATION_STATUSES),
        approved_applications=app_counts.get(ApplicationStatus.APPROVED, 0),
        rejected_applications=app_counts.get(ApplicationStatus.REJECTED, 0),
        changes_requested=app_counts.get(ApplicationStatus.CHANGES_REQUESTED, 0),
        cameras_live=camera_counts.get(CameraStatus.LIVE, 0),
        cameras_total=sum(camera_counts.values()),
        active_alerts=await count(select(func.count()).where(Alert.status.in_(OPEN_ALERT_STATUSES))),
        high_priority_alerts=await count(
            select(func.count()).where(Alert.status.in_(OPEN_ALERT_STATUSES), Alert.severity == AlertSeverity.HIGH)
        ),
        resolved_incidents=await count(select(func.count()).where(Incident.status == IncidentStatus.RESOLVED)),
        registered_users=await count(select(func.count()).select_from(User)),
    )

    months = _month_starts(6)
    since = datetime.combine(months[0], time.min, UTC)
    submitted_rows = dict(
        (
            await db.execute(
                select(func.date_trunc("month", ParkingApplication.submitted_at).label("m"), func.count())
                .where(ParkingApplication.submitted_at >= since)
                .group_by("m")
            )
        ).all()
    )
    approved_rows = dict(
        (
            await db.execute(
                select(func.date_trunc("month", ParkingApplication.decided_at).label("m"), func.count())
                .where(ParkingApplication.decided_at >= since, ParkingApplication.status == ApplicationStatus.APPROVED)
                .group_by("m")
            )
        ).all()
    )

    def by_month(rows: dict[Any, int], month: date) -> int:
        return sum(v for k, v in rows.items() if k is not None and k.date() == month)

    area_rows = (
        await db.execute(
            select(Camera.area, func.count(Alert.id))
            .join(Camera, Camera.id == Alert.camera_id)
            .where(Alert.detected_at >= now - timedelta(days=30))
            .group_by(Camera.area)
            .order_by(func.count(Alert.id).desc())
            .limit(6)
        )
    ).all()

    day_start = datetime.combine(now.date() - timedelta(days=6), time.min, UTC)
    activity_rows = dict(
        (
            await db.execute(
                select(func.date_trunc("day", Alert.detected_at).label("d"), func.count())
                .where(Alert.detected_at >= day_start)
                .group_by("d")
            )
        ).all()
    )
    days = [(day_start + timedelta(days=i)).date() for i in range(7)]

    charts = ChartStats(
        applications_over_time=[
            MonthPoint(
                month=m.strftime("%b"), submitted=by_month(submitted_rows, m), approved=by_month(approved_rows, m)
            )
            for m in months
        ],
        outcomes=OutcomeSlice(
            approved=overview.approved_applications,
            rejected=overview.rejected_applications,
            changes_requested=overview.changes_requested,
        ),
        incidents_by_area=[AreaCount(area=row[0], count=row[1]) for row in area_rows],
        cctv_activity=[
            ActivityPoint(
                label=d.strftime("%a"),
                detections=sum(v for k, v in activity_rows.items() if k is not None and k.date() == d),
            )
            for d in days
        ],
    )
    return DashboardStats(overview=overview, charts=charts)


@router.get("/stats", response_model=DashboardStats, summary="Dashboard counters and charts (cached 60s)")
async def dashboard_stats(_: AdminUser, db: DbSession) -> DashboardStats:
    cached = await redis_client.get(STATS_CACHE_KEY)
    if cached:
        return DashboardStats.model_validate(json.loads(cached))
    stats = await _compute_stats(db)
    await redis_client.set(STATS_CACHE_KEY, stats.model_dump_json(), ex=STATS_TTL_SECONDS)
    return stats


# --------------------------------------------------------------------------- national map

MapLayer = Literal["approved", "pending", "rejected", "cameras", "incidents"]


@router.get("/map", response_model=AdminMapOut, summary="Government-wide operational map")
async def admin_map(
    _: AdminUser,
    db: DbSession,
    layers: Annotated[list[MapLayer] | None, Query()] = None,
) -> AdminMapOut:
    active = set(layers or ["approved", "pending", "rejected", "cameras", "incidents"])
    markers: list[MapMarker] = []
    counts: dict[str, int] = {}

    parkings = (await db.scalars(select(ParkingLocation).where(ParkingLocation.is_published.is_(True)))).all()
    counts["approved"] = len(parkings)
    if "approved" in active:
        for p in parkings:
            tone = parking_service.to_summary(p).marker_tone
            markers.append(
                MapMarker(
                    id=p.id,
                    kind="parking",
                    name=p.name,
                    subtitle=f"{p.area} · {p.capacity} spaces",
                    latitude=p.latitude,
                    longitude=p.longitude,
                    tone=tone,
                    status=p.status.value,
                )
            )

    apps = (
        await db.scalars(
            select(ParkingApplication).where(
                ParkingApplication.status.in_(
                    [*PENDING_APPLICATION_STATUSES, ApplicationStatus.REJECTED, ApplicationStatus.CHANGES_REQUESTED]
                ),
                ParkingApplication.latitude.is_not(None),
            )
        )
    ).all()
    pending = [a for a in apps if a.status != ApplicationStatus.REJECTED]
    rejected = [a for a in apps if a.status == ApplicationStatus.REJECTED]
    counts["pending"], counts["rejected"] = len(pending), len(rejected)
    for layer, group, kind, tone in (
        ("pending", pending, "pending", "gray"),
        ("rejected", rejected, "rejected", "red"),
    ):
        if layer in active:
            markers.extend(
                MapMarker(
                    id=a.id,
                    kind=kind,
                    name=a.property_name or "Proposed parking",
                    subtitle=f"{a.reference} · {a.status.value.replace('_', ' ')}",
                    latitude=a.latitude,
                    longitude=a.longitude,
                    tone=tone,
                    status=a.status.value,
                )
                for a in group
            )

    cameras = (await db.scalars(select(Camera))).all()
    counts["cameras"] = len(cameras)
    if "cameras" in active:
        markers.extend(
            MapMarker(
                id=c.id,
                kind="camera",
                name=c.code,
                subtitle=c.road,
                latitude=c.latitude,
                longitude=c.longitude,
                tone="camera",
                status=c.status.value,
            )
            for c in cameras
        )

    alerts = (
        await db.scalars(select(Alert).options(selectinload(Alert.camera)).where(Alert.status.in_(OPEN_ALERT_STATUSES)))
    ).all()
    counts["incidents"] = len(alerts)
    if "incidents" in active:
        markers.extend(
            MapMarker(
                id=a.id,
                kind="incident",
                name=VIOLATION_LABELS[a.violation_type],
                subtitle=f"{a.camera.road} · {a.camera.code}",
                latitude=a.latitude,
                longitude=a.longitude,
                tone="incident",
                status=a.status.value,
            )
            for a in alerts
        )
    return AdminMapOut(markers=markers, counts=counts)


# --------------------------------------------------------------------------- users


class RoleCounts(BaseModel):
    total: int
    public: int
    police: int
    admin: int


@router.get("/users", response_model=Page[UserOut])
async def list_users(filters: Annotated[UserFilters, Query()], _: AdminUser, db: DbSession) -> dict[str, Any]:
    stmt = select(User)
    if filters.q:
        pattern = f"%{escape_like(filters.q.strip())}%"
        stmt = stmt.where(
            or_(
                User.full_name.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
                User.phone.ilike(pattern, escape="\\"),
                User.badge_number.ilike(pattern, escape="\\"),
            )
        )
    if filters.role:
        stmt = stmt.where(User.role == filters.role)
    if filters.status:
        stmt = stmt.where(User.status == filters.status)
    order = {"newest": User.created_at.desc(), "oldest": User.created_at.asc(), "name": User.full_name.asc()}[
        filters.sort
    ]
    return await paginate(db, stmt.order_by(order, User.id), filters)


@router.get("/users/counts", response_model=RoleCounts)
async def user_counts(_: AdminUser, db: DbSession) -> RoleCounts:
    rows = dict((await db.execute(select(User.role, func.count()).group_by(User.role))).all())
    return RoleCounts(
        total=sum(rows.values()),
        public=rows.get(UserRole.PUBLIC, 0),
        police=rows.get(UserRole.POLICE, 0),
        admin=rows.get(UserRole.ADMIN, 0),
    )


@router.post(
    "/users", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="Create a police or admin account"
)
async def create_staff(request: Request, body: StaffCreate, admin: AdminUser, db: DbSession) -> User:
    email = normalize_email(body.email)
    fields: dict[str, str] = {}
    if await db.scalar(select(User.id).where(User.email == email)):
        fields["email"] = "This email is already registered."
    if await db.scalar(select(User.id).where(User.phone == body.phone)):
        fields["phone"] = "This phone number is already registered."
    if body.badge_number and await db.scalar(select(User.id).where(User.badge_number == body.badge_number.upper())):
        fields["badge_number"] = "This badge number is already registered."
    if fields:
        raise AppError(status.HTTP_409_CONFLICT, "account_exists", "Some details are already in use.", fields)
    user = User(
        full_name=body.full_name.strip(),
        email=email,
        phone=body.phone,
        password_hash=hash_password(body.password),
        role=body.role,
        designation=body.designation,
        badge_number=body.badge_number.upper() if body.badge_number else None,
        unit=body.unit,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    audit.record(
        db,
        actor=admin,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        ip_address=client_ip(request),
        role=body.role.value,
    )
    await db.commit()
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(request: Request, user_id: uuid.UUID, body: UserUpdate, admin: AdminUser, db: DbSession) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise not_found("User")
    changes = body.model_dump(exclude_unset=True)
    if user.id == admin.id and ("status" in changes or "role" in changes):
        raise conflict("You cannot change your own role or status.", "self_change")
    for field, value in changes.items():
        setattr(user, field, value)
    if changes.get("status") == "suspended":
        await revoke_all_sessions(db, user)
    audit.record(
        db,
        actor=admin,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        ip_address=client_ip(request),
        **{k: str(v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(user)
    return user


# --------------------------------------------------------------------------- audit log


class AuditOut(BaseModel):
    id: uuid.UUID
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    actor_name: str | None
    meta: dict[str, Any]
    ip_address: str | None
    created_at: datetime


@router.get("/audit-logs", response_model=Page[AuditOut])
async def audit_logs(
    params: Annotated[PageParams, Query()],
    _: AdminUser,
    db: DbSession,
    action: Annotated[str | None, Query(max_length=64)] = None,
) -> dict[str, Any]:
    stmt = select(AuditLog, User.full_name).outerjoin(User, User.id == AuditLog.actor_id)
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action))
    stmt = stmt.order_by(AuditLog.created_at.desc(), AuditLog.id)
    return await paginate(
        db,
        stmt,
        params,
        scalars=False,
        transform=lambda row: AuditOut(
            id=row[0].id,
            action=row[0].action,
            entity_type=row[0].entity_type,
            entity_id=row[0].entity_id,
            actor_name=row[1],
            meta=row[0].meta,
            ip_address=row[0].ip_address,
            created_at=row[0].created_at,
        ),
    )
