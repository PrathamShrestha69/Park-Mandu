import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, time, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, status
from sqlalchemy import func, or_, select
from sse_starlette.sse import EventSourceResponse

from app.api.deps import DbSession, PoliceUser, client_ip
from app.core.config import settings
from app.core.errors import AppError, conflict, not_found
from app.core.rate_limit import limiter
from app.core.redis import ALERTS_CHANNEL, redis_client
from app.core.security import constant_time_equals
from app.models.enums import (
    OPEN_ALERT_STATUSES,
    AlertSeverity,
    AlertStatus,
    CameraStatus,
    IncidentStatus,
    TrafficLevel,
)
from app.models.monitoring import Alert, Camera, Incident, IncidentNote
from app.models.user import User
from app.schemas.common import JobAccepted
from app.schemas.monitoring import (
    AlertCounts,
    AlertFilters,
    AlertOut,
    CameraCounts,
    CameraFilters,
    CameraOut,
    DetectionIngest,
    DismissRequest,
    IncidentDetail,
    IncidentFilters,
    IncidentSummary,
    NoteCreate,
    PoliceDashboard,
    ResolveRequest,
    RoadCondition,
)
from app.schemas.user import DutyUpdate, UserOut
from app.services import audit
from app.services.monitoring import (
    SEVERITY_ORDER,
    alert_query,
    alert_to_out,
    incident_query,
    incident_to_detail,
    incident_to_summary,
)
from app.utils.pagination import Page, paginate
from app.utils.text import escape_like
from app.worker.tasks import ingest_detection

router = APIRouter(tags=["monitoring"])

TRAFFIC_ORDER = {TrafficLevel.CONGESTED: 0, TrafficLevel.SLOW: 1, TrafficLevel.MODERATE: 2, TrafficLevel.CLEAR: 3}


def _active_violations_subquery() -> Any:
    return (
        select(Alert.camera_id, func.count().label("active"))
        .where(Alert.status.in_(OPEN_ALERT_STATUSES))
        .group_by(Alert.camera_id)
        .subquery()
    )


def _camera_out(camera: Camera, active: int | None) -> CameraOut:
    out = CameraOut.model_validate(camera)
    out.active_violations = int(active or 0)
    return out


async def _camera_counts(db: DbSession) -> CameraCounts:
    rows = dict((await db.execute(select(Camera.status, func.count()).group_by(Camera.status))).all())
    return CameraCounts(
        total=sum(rows.values()),
        live=rows.get(CameraStatus.LIVE, 0),
        offline=rows.get(CameraStatus.OFFLINE, 0),
        maintenance=rows.get(CameraStatus.MAINTENANCE, 0),
    )


async def _alert_counts(db: DbSession) -> AlertCounts:
    rows = dict((await db.execute(select(Alert.status, func.count()).group_by(Alert.status))).all())
    high = await db.scalar(
        select(func.count()).where(Alert.status.in_(OPEN_ALERT_STATUSES), Alert.severity == AlertSeverity.HIGH)
    )
    today = datetime.combine(datetime.now(UTC).date(), time.min, UTC)
    resolved_today = await db.scalar(
        select(func.count()).where(Alert.status == AlertStatus.RESOLVED, Alert.closed_at >= today)
    )
    return AlertCounts(
        open=rows.get(AlertStatus.ACTIVE, 0) + rows.get(AlertStatus.ASSIGNED, 0),
        active=rows.get(AlertStatus.ACTIVE, 0),
        assigned=rows.get(AlertStatus.ASSIGNED, 0),
        high_priority=int(high or 0),
        resolved_today=int(resolved_today or 0),
    )


# --------------------------------------------------------------------------- dashboard


@router.get("/police/dashboard", response_model=PoliceDashboard, tags=["police"])
async def police_dashboard(officer: PoliceUser, db: DbSession) -> PoliceDashboard:
    latest = await db.scalar(
        alert_query()
        .where(Alert.status == AlertStatus.ACTIVE)
        .order_by(SEVERITY_ORDER, Alert.detected_at.desc())
        .limit(1)
    )
    mine = await db.scalar(
        select(func.count()).where(Incident.officer_id == officer.id, Incident.status == IncidentStatus.IN_PROGRESS)
    )
    cameras = (await db.scalars(select(Camera).where(Camera.status == CameraStatus.LIVE))).all()
    conditions = sorted(cameras, key=lambda c: (TRAFFIC_ORDER[c.traffic_level], c.avg_speed_kmh))[:5]
    return PoliceDashboard(
        officer=UserOut.model_validate(officer),
        alerts=await _alert_counts(db),
        cameras=await _camera_counts(db),
        latest_alert=alert_to_out(latest) if latest else None,
        open_incidents_mine=int(mine or 0),
        road_conditions=[
            RoadCondition(
                camera_code=c.code,
                road=c.road,
                area=c.area,
                traffic_level=c.traffic_level,
                avg_speed_kmh=c.avg_speed_kmh,
            )
            for c in conditions
        ],
    )


@router.patch("/police/duty", response_model=UserOut, tags=["police"])
async def set_duty(request: Request, body: DutyUpdate, officer: PoliceUser, db: DbSession) -> User:
    officer.on_duty = body.on_duty
    audit.record(
        db,
        actor=officer,
        action="police.duty",
        entity_type="user",
        entity_id=officer.id,
        ip_address=client_ip(request),
        on_duty=body.on_duty,
    )
    await db.commit()
    await db.refresh(officer)
    return officer


# --------------------------------------------------------------------------- cameras


@router.get("/cameras", response_model=Page[CameraOut], tags=["cameras"])
async def list_cameras(filters: Annotated[CameraFilters, Query()], _: PoliceUser, db: DbSession) -> dict[str, Any]:
    active = _active_violations_subquery()
    stmt = select(Camera, active.c.active).outerjoin(active, active.c.camera_id == Camera.id)
    if filters.q:
        pattern = f"%{escape_like(filters.q.strip())}%"
        stmt = stmt.where(
            or_(
                Camera.code.ilike(pattern, escape="\\"),
                Camera.name.ilike(pattern, escape="\\"),
                Camera.road.ilike(pattern, escape="\\"),
                Camera.area.ilike(pattern, escape="\\"),
            )
        )
    if filters.status:
        stmt = stmt.where(Camera.status == filters.status)
    if filters.area:
        stmt = stmt.where(Camera.area == filters.area)
    stmt = stmt.order_by(func.coalesce(active.c.active, 0).desc(), Camera.code)
    return await paginate(db, stmt, filters, scalars=False, transform=lambda row: _camera_out(row[0], row[1]))


@router.get("/cameras/counts", response_model=CameraCounts, tags=["cameras"])
async def camera_counts(_: PoliceUser, db: DbSession) -> CameraCounts:
    return await _camera_counts(db)


@router.get("/cameras/{camera_id}", response_model=CameraOut, tags=["cameras"])
async def get_camera(camera_id: uuid.UUID, _: PoliceUser, db: DbSession) -> CameraOut:
    active = _active_violations_subquery()
    row = (
        await db.execute(
            select(Camera, active.c.active)
            .outerjoin(active, active.c.camera_id == Camera.id)
            .where(Camera.id == camera_id)
        )
    ).first()
    if row is None:
        raise not_found("Camera")
    return _camera_out(row[0], row[1])


# --------------------------------------------------------------------------- alerts


@router.get("/alerts", response_model=Page[AlertOut], tags=["alerts"])
async def list_alerts(filters: Annotated[AlertFilters, Query()], _: PoliceUser, db: DbSession) -> dict[str, Any]:
    stmt = alert_query().join(Camera, Camera.id == Alert.camera_id)
    if filters.status == "open":
        stmt = stmt.where(Alert.status.in_(OPEN_ALERT_STATUSES))
    elif filters.status == "closed":
        stmt = stmt.where(Alert.status.in_([AlertStatus.RESOLVED, AlertStatus.DISMISSED]))
    elif filters.status:
        stmt = stmt.where(Alert.status == AlertStatus(filters.status))
    if filters.severity:
        stmt = stmt.where(Alert.severity == filters.severity)
    if filters.camera_id:
        stmt = stmt.where(Alert.camera_id == filters.camera_id)
    if filters.area:
        stmt = stmt.where(Camera.area == filters.area)
    if filters.violation_type:
        stmt = stmt.where(Alert.violation_type == filters.violation_type)
    if filters.detected_from:
        stmt = stmt.where(Alert.detected_at >= filters.detected_from)
    if filters.detected_to:
        stmt = stmt.where(Alert.detected_at <= filters.detected_to)
    if filters.within_hours:
        stmt = stmt.where(Alert.detected_at >= datetime.now(UTC) - timedelta(hours=filters.within_hours))
    if filters.q:
        pattern = f"%{escape_like(filters.q.strip())}%"
        stmt = stmt.where(
            or_(
                Alert.code.ilike(pattern, escape="\\"),
                Alert.plate_number.ilike(pattern, escape="\\"),
                Camera.road.ilike(pattern, escape="\\"),
            )
        )
    order = {
        "newest": (Alert.detected_at.desc(),),
        "oldest": (Alert.detected_at.asc(),),
        "severity": (SEVERITY_ORDER, Alert.detected_at.desc()),
    }[filters.sort]
    stmt = stmt.order_by(*order, Alert.id)
    return await paginate(db, stmt, filters, transform=alert_to_out)


@router.get("/alerts/counts", response_model=AlertCounts, tags=["alerts"])
async def alert_counts(_: PoliceUser, db: DbSession) -> AlertCounts:
    return await _alert_counts(db)


@router.get("/alerts/areas", response_model=list[str], tags=["alerts"])
async def alert_areas(_: PoliceUser, db: DbSession) -> list[str]:
    return list(await db.scalars(select(Camera.area).distinct().order_by(Camera.area)))


@router.get("/alerts/stream", tags=["alerts"], summary="Server-sent events for new detections")
async def alert_stream(request: Request, _: PoliceUser) -> EventSourceResponse:
    async def events() -> AsyncIterator[dict[str, str]]:
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(ALERTS_CHANNEL)
        try:
            while not await request.is_disconnected():
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("type") == "message":
                    yield {"event": "alert", "data": message["data"]}
                await asyncio.sleep(0.05)
        finally:
            await pubsub.unsubscribe(ALERTS_CHANNEL)
            await pubsub.aclose()

    return EventSourceResponse(events(), ping=15)


async def _load_alert(db: DbSession, alert_id: uuid.UUID) -> Alert:
    alert = await db.scalar(alert_query().where(Alert.id == alert_id).execution_options(populate_existing=True))
    if alert is None:
        raise not_found("Alert")
    return alert


@router.get("/alerts/{alert_id}", response_model=AlertOut, tags=["alerts"])
async def get_alert(alert_id: uuid.UUID, _: PoliceUser, db: DbSession) -> AlertOut:
    return alert_to_out(await _load_alert(db, alert_id))


@router.post(
    "/alerts/{alert_id}/handle",
    response_model=IncidentDetail,
    tags=["alerts"],
    summary="Take ownership — opens an incident",
)
async def handle_alert(request: Request, alert_id: uuid.UUID, officer: PoliceUser, db: DbSession) -> IncidentDetail:
    # Row lock prevents two officers claiming the same alert at once.
    alert = await db.scalar(select(Alert).where(Alert.id == alert_id).with_for_update())
    if alert is None:
        raise not_found("Alert")
    if alert.status != AlertStatus.ACTIVE:
        existing = await db.scalar(select(Incident.id).where(Incident.alert_id == alert.id))
        if existing and alert.assigned_officer_id == officer.id:
            return await _incident_detail(db, existing)
        raise conflict("This alert has already been taken by another officer or closed.", "alert_taken")
    alert.status = AlertStatus.ASSIGNED
    alert.assigned_officer_id = officer.id
    incident = Incident(alert_id=alert.id, officer_id=officer.id)
    db.add(incident)
    await db.flush()
    incident.code = f"INC-{incident.seq}"
    audit.record(
        db,
        actor=officer,
        action="alert.handled",
        entity_type="alert",
        entity_id=alert.id,
        ip_address=client_ip(request),
        incident=incident.code,
    )
    await db.commit()
    return await _incident_detail(db, incident.id)


@router.post("/alerts/{alert_id}/dismiss", response_model=AlertOut, tags=["alerts"])
async def dismiss_alert(
    request: Request, alert_id: uuid.UUID, body: DismissRequest, officer: PoliceUser, db: DbSession
) -> AlertOut:
    alert = await _load_alert(db, alert_id)
    if alert.status not in OPEN_ALERT_STATUSES:
        raise conflict("This alert is already closed.", "alert_closed")
    if alert.incident is not None:
        raise conflict("This alert has an open incident. Resolve the incident instead.", "has_incident")
    alert.status = AlertStatus.DISMISSED
    alert.dismiss_reason = body.reason.strip()
    alert.closed_at = datetime.now(UTC)
    audit.record(
        db,
        actor=officer,
        action="alert.dismissed",
        entity_type="alert",
        entity_id=alert.id,
        ip_address=client_ip(request),
        reason=body.reason,
    )
    await db.commit()
    return alert_to_out(await _load_alert(db, alert_id))


# --------------------------------------------------------------------------- incidents


async def _incident_detail(db: DbSession, incident_id: uuid.UUID) -> IncidentDetail:
    # Objects created earlier in this request have unloaded relationships; start from a clean identity map.
    db.expunge_all()
    incident = await db.scalar(incident_query().where(Incident.id == incident_id))
    if incident is None:
        raise not_found("Incident")
    return incident_to_detail(incident)


@router.get("/incidents", response_model=Page[IncidentSummary], tags=["incidents"])
async def list_incidents(
    filters: Annotated[IncidentFilters, Query()], officer: PoliceUser, db: DbSession
) -> dict[str, Any]:
    stmt = incident_query().join(Alert, Alert.id == Incident.alert_id)
    if filters.status:
        stmt = stmt.where(Incident.status == filters.status)
    if filters.mine:
        stmt = stmt.where(Incident.officer_id == officer.id)
    if filters.q:
        pattern = f"%{escape_like(filters.q.strip())}%"
        stmt = stmt.where(
            or_(Incident.code.ilike(pattern, escape="\\"), Alert.plate_number.ilike(pattern, escape="\\"))
        )
    stmt = stmt.order_by(Incident.created_at.desc(), Incident.id)
    return await paginate(db, stmt, filters, transform=incident_to_summary)


@router.get("/incidents/{incident_id}", response_model=IncidentDetail, tags=["incidents"])
async def get_incident(incident_id: uuid.UUID, _: PoliceUser, db: DbSession) -> IncidentDetail:
    return await _incident_detail(db, incident_id)


@router.post(
    "/incidents/{incident_id}/notes",
    response_model=IncidentDetail,
    status_code=status.HTTP_201_CREATED,
    tags=["incidents"],
)
async def add_note(incident_id: uuid.UUID, body: NoteCreate, officer: PoliceUser, db: DbSession) -> IncidentDetail:
    incident = await db.get(Incident, incident_id)
    if incident is None:
        raise not_found("Incident")
    db.add(IncidentNote(incident_id=incident.id, author_id=officer.id, body=body.body.strip()))
    await db.commit()
    return await _incident_detail(db, incident_id)


@router.post("/incidents/{incident_id}/resolve", response_model=IncidentDetail, tags=["incidents"])
async def resolve_incident(
    request: Request, incident_id: uuid.UUID, body: ResolveRequest, officer: PoliceUser, db: DbSession
) -> IncidentDetail:
    incident = await db.scalar(select(Incident).where(Incident.id == incident_id).with_for_update())
    if incident is None:
        raise not_found("Incident")
    if incident.status == IncidentStatus.RESOLVED:
        raise conflict("This incident is already resolved.", "already_resolved")
    now = datetime.now(UTC)
    incident.status = IncidentStatus.RESOLVED
    incident.resolution = body.resolution.strip()
    incident.resolved_at = now
    alert = await db.get(Alert, incident.alert_id)
    if alert is not None:
        alert.status = AlertStatus.RESOLVED
        alert.closed_at = now
    audit.record(
        db,
        actor=officer,
        action="incident.resolved",
        entity_type="incident",
        entity_id=incident.id,
        ip_address=client_ip(request),
    )
    await db.commit()
    return await _incident_detail(db, incident_id)


# --------------------------------------------------------------------------- ingestion


@router.post(
    "/ingest/detections",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["ingest"],
    summary="Video-analytics systems push detections here (X-API-Key)",
)
@limiter.limit("600/minute")
async def ingest(request: Request, body: DetectionIngest, x_api_key: Annotated[str, Header()]) -> JobAccepted:
    if not constant_time_equals(x_api_key, settings.ingest_api_key):
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_api_key", "Invalid API key.")
    job = ingest_detection.delay(body.model_dump(mode="json"))
    return JobAccepted(job_id=job.id)
