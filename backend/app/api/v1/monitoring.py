import asyncio
import base64
import binascii
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, time, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, status
from sqlalchemy import func, or_, select
from sse_starlette.sse import EventSourceResponse

from app.api.deps import DbSession, PoliceUser, client_ip
from app.core.config import KATHMANDU_CENTER, settings
from app.core.errors import AppError, conflict, not_found
from app.core.rate_limit import limiter
from app.core.realtime import emit, role_room
from app.core.redis import ALERTS_CHANNEL, redis_client
from app.core.security import constant_time_equals
from app.models.enums import (
    OPEN_ALERT_STATUSES,
    AlertSeverity,
    AlertStatus,
    CameraStatus,
    DispatchStatus,
    IncidentStatus,
    ParkingState,
    TrafficLevel,
    TrafficStatus,
    UserRole,
)
from app.models.monitoring import POLICE_CAMERA, Alert, AlertDispatch, Camera, Incident, IncidentNote, ParkedVehicle
from app.models.parking import ParkingLocation
from app.models.user import User
from app.schemas.common import JobAccepted, MessageOut
from app.schemas.monitoring import (
    AlertCounts,
    AlertFilters,
    AlertOut,
    CameraCounts,
    CameraFilters,
    CameraHeartbeat,
    CameraOut,
    CameraTracking,
    CameraTrackingOut,
    DeclineRequest,
    DetectionIngest,
    DetectorConfig,
    DismissRequest,
    DispatchOut,
    HeartbeatAccepted,
    IncidentDetail,
    IncidentFilters,
    IncidentSummary,
    LocationUpdate,
    NoteCreate,
    ParkedVehicleOut,
    ParkingStatusAccepted,
    ParkingStatusIngest,
    PoliceDashboard,
    ResolveRequest,
    RoadCondition,
    TelemetryAccepted,
    TelemetryIngest,
    TrackingSummary,
)
from app.schemas.user import DutyUpdate, UserOut
from app.services import audit, dispatch, occupancy, parking_enforcement, storage
from app.services.alerts_sync import MIN_CONFIDENCE
from app.services.monitoring import (
    SEVERITY_ORDER,
    alert_query,
    alert_to_out,
    incident_query,
    incident_to_detail,
    incident_to_summary,
)
from app.services.traffic import TRACKING_TTL_SECONDS, decode_tracking, measured_level, tracking_key, traffic_status
from app.utils.pagination import Page, paginate
from app.utils.text import escape_like
from app.worker.tasks import evaluate_parked_vehicle_task, ingest_detection, reassess_parking_task

router = APIRouter(tags=["monitoring"])

TRAFFIC_ORDER = {TrafficLevel.CONGESTED: 0, TrafficLevel.SLOW: 1, TrafficLevel.MODERATE: 2, TrafficLevel.CLEAR: 3}


def _active_violations_subquery() -> Any:
    return (
        select(Alert.camera_id, func.count().label("active"))
        .where(Alert.status.in_(OPEN_ALERT_STATUSES))
        .group_by(Alert.camera_id)
        .subquery()
    )


def _camera_out(camera: Camera, active: int | None, tracking: dict[str, Any] | None = None) -> CameraOut:
    out = CameraOut.model_validate(camera)
    out.active_violations = int(active or 0)
    # Simulated cameras carry a placeholder address that no client can open.
    if not camera.ai_enabled:
        out.stream_url = None
    if tracking and camera.ai_enabled:
        out.tracking = TrackingSummary.model_validate(tracking)
    return out


async def _live_tracking(cameras: list[Camera]) -> dict[uuid.UUID, dict[str, Any]]:
    """Latest tracking update of each AI camera that is reporting right now."""
    ai = [c for c in cameras if c.ai_enabled]
    if not ai:
        return {}
    raw = await redis_client.mget([tracking_key(c.id) for c in ai])
    decoded = ((c.id, decode_tracking(value)) for c, value in zip(ai, raw, strict=True))
    return {camera_id: data for camera_id, data in decoded if data}


async def _camera_counts(db: DbSession) -> CameraCounts:
    rows = dict(
        (await db.execute(select(Camera.status, func.count()).where(POLICE_CAMERA).group_by(Camera.status))).all()
    )
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
    cameras = (await db.scalars(select(Camera).where(Camera.status == CameraStatus.LIVE, POLICE_CAMERA))).all()
    conditions = sorted(cameras, key=lambda c: (TRAFFIC_ORDER[c.traffic_level], c.avg_speed_kmh))[:5]
    tracking = await _live_tracking(conditions)
    return PoliceDashboard(
        officer=UserOut.model_validate(officer),
        alerts=await _alert_counts(db),
        cameras=await _camera_counts(db),
        latest_alert=alert_to_out(latest) if latest else None,
        open_incidents_mine=int(mine or 0),
        road_conditions=[
            RoadCondition(
                camera_id=c.id,
                camera_code=c.code,
                road=c.road,
                area=c.area,
                traffic_level=c.traffic_level,
                avg_speed_kmh=c.avg_speed_kmh,
                source="ai" if c.ai_enabled else "simulated",
                vehicle_count=tracking[c.id]["vehicle_count"] if c.id in tracking else None,
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


@router.put("/police/location", response_model=MessageOut, tags=["police"], summary="Report the officer position")
@limiter.limit("30/minute")
async def update_location(request: Request, body: LocationUpdate, officer: PoliceUser, db: DbSession) -> MessageOut:
    # Dispatch picks the nearest on-duty officer from these reports; stale ones are ignored.
    officer.latitude = body.latitude
    officer.longitude = body.longitude
    officer.location_updated_at = datetime.now(UTC)
    await db.commit()
    return MessageOut(message="Location updated.")


def _dispatch_out(row: AlertDispatch, message: str) -> DispatchOut:
    return DispatchOut(
        alert_id=row.alert_id,
        status=row.status.value,
        officer_id=row.officer_id,
        distance_m=round(row.distance_m) if row.distance_m is not None else None,
        message=message,
    )


@router.get("/police/dispatches", response_model=list[DispatchOut], tags=["police"])
async def my_dispatches(officer: PoliceUser, db: DbSession) -> list[DispatchOut]:
    """Call-outs sent to this officer that are still open."""
    rows = await db.scalars(
        select(AlertDispatch)
        .join(Alert, Alert.id == AlertDispatch.alert_id)
        .where(
            AlertDispatch.officer_id == officer.id,
            AlertDispatch.status.in_([DispatchStatus.NOTIFIED, DispatchStatus.ACKNOWLEDGED]),
            Alert.status.in_(OPEN_ALERT_STATUSES),
        )
        .order_by(AlertDispatch.notified_at.desc())
    )
    return [_dispatch_out(row, "") for row in rows]


async def _announce_dispatch(alert_id: uuid.UUID, state: str) -> None:
    for role in (UserRole.POLICE, UserRole.ADMIN):
        await emit("dispatch:update", {"alert_id": str(alert_id), "status": state}, role_room(role.value))


def _respond(alert_id: uuid.UUID, officer_id: uuid.UUID, accepted: bool) -> AlertDispatch | None:
    from app.db.session import SyncSessionLocal

    with SyncSessionLocal() as session:
        row = dispatch.record_response(session, alert_id, officer_id, accepted=accepted)
        if row is not None:
            session.refresh(row)
            session.expunge(row)
        return row


def _redispatch(alert_id: uuid.UUID) -> None:
    from app.db.session import SyncSessionLocal

    with SyncSessionLocal() as session:
        dispatch.dispatch_alert(session, alert_id)


NOT_YOURS = "This call-out is no longer assigned to you, or has already been answered."


@router.post("/alerts/{alert_id}/acknowledge", response_model=DispatchOut, tags=["alerts"])
async def acknowledge_dispatch(alert_id: uuid.UUID, officer: PoliceUser, db: DbSession) -> DispatchOut:
    """The officer who was sent to this alert confirms they are responding."""
    officer_id = officer.id  # read before the rollback expires the loaded user
    await db.rollback()  # release the read transaction; the work below runs in its own sync session
    row = await asyncio.to_thread(_respond, alert_id, officer_id, True)
    if row is None:
        raise conflict(NOT_YOURS, "dispatch_not_yours")
    await _announce_dispatch(alert_id, row.status.value)
    return _dispatch_out(row, "Thanks, the control room knows you are on the way.")


@router.post("/alerts/{alert_id}/decline", response_model=DispatchOut, tags=["alerts"])
async def decline_dispatch(
    alert_id: uuid.UUID, body: DeclineRequest, officer: PoliceUser, db: DbSession
) -> DispatchOut:
    """The officer cannot respond; the next nearest available officer (and only that one) is notified."""
    officer_id = officer.id  # read before the rollback expires the loaded user
    await db.rollback()
    row = await asyncio.to_thread(_respond, alert_id, officer_id, False)
    if row is None:
        raise conflict(NOT_YOURS, "dispatch_not_yours")
    await asyncio.to_thread(_redispatch, alert_id)
    await _announce_dispatch(alert_id, row.status.value)
    return _dispatch_out(row, "Understood. The call-out has been passed to the next nearest officer.")


# --------------------------------------------------------------------------- cameras


@router.get("/cameras", response_model=Page[CameraOut], tags=["cameras"])
async def list_cameras(filters: Annotated[CameraFilters, Query()], _: PoliceUser, db: DbSession) -> dict[str, Any]:
    active = _active_violations_subquery()
    stmt = select(Camera, active.c.active).outerjoin(active, active.c.camera_id == Camera.id).where(POLICE_CAMERA)
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
    page = await paginate(db, stmt, filters, scalars=False)
    tracking = await _live_tracking([row[0] for row in page["items"]])
    page["items"] = [_camera_out(row[0], row[1], tracking.get(row[0].id)) for row in page["items"]]
    return page


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
            .where(Camera.id == camera_id, POLICE_CAMERA)
        )
    ).first()
    if row is None:
        raise not_found("Camera")
    tracking = await _live_tracking([row[0]])
    return _camera_out(row[0], row[1], tracking.get(row[0].id))


@router.get(
    "/cameras/{camera_id}/tracking",
    response_model=CameraTrackingOut,
    tags=["cameras"],
    summary="Vehicles an AI detector is tracking on this camera right now",
)
async def camera_tracking(camera_id: uuid.UUID, _: PoliceUser, db: DbSession) -> CameraTrackingOut:
    camera = await db.get(Camera, camera_id)
    if camera is None or camera.owner_id is not None:
        raise not_found("Camera")
    data = decode_tracking(await redis_client.get(tracking_key(camera.id))) if camera.ai_enabled else None
    return CameraTrackingOut(
        camera_id=camera.id,
        camera_code=camera.code,
        ai_enabled=camera.ai_enabled,
        traffic_level=camera.traffic_level,
        avg_speed_kmh=camera.avg_speed_kmh,
        tracking=CameraTracking.model_validate(data) if data else None,
    )


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
    return list(await db.scalars(select(Camera.area).where(POLICE_CAMERA).distinct().order_by(Camera.area)))


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


async def _broadcast_alert_update(alert_id: uuid.UUID, state: str) -> None:
    for role in (UserRole.POLICE, UserRole.ADMIN):
        await emit("alert:update", {"alert_id": str(alert_id), "status": state}, role_room(role.value))


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
    sent = await db.scalar(select(AlertDispatch).where(AlertDispatch.alert_id == alert.id).with_for_update())
    if sent is not None and sent.officer_id == officer.id and sent.status == DispatchStatus.NOTIFIED:
        sent.status = DispatchStatus.ACKNOWLEDGED  # taking the job answers the call-out
        sent.responded_at = datetime.now(UTC)
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
    await _broadcast_alert_update(alert_id, "assigned")
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
    await _broadcast_alert_update(alert_id, "dismissed")
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
    await _broadcast_alert_update(incident.alert_id, "resolved")
    return await _incident_detail(db, incident_id)


# --------------------------------------------------------------------------- ingestion

TRACKING_PUSH_INTERVAL = 2  # seconds; detectors report faster than screens need


async def _broadcast_tracking(camera: Camera, tracking: CameraTracking) -> None:
    """Pushes the headline tracking numbers to officers screens, at most once per interval per camera."""
    if not await redis_client.set(f"cameras:tracking:push:{camera.id}", "1", nx=True, ex=TRACKING_PUSH_INTERVAL):
        return
    await emit(
        "tracking:update",
        {
            "camera_id": str(camera.id),
            "camera_code": camera.code,
            "traffic_level": camera.traffic_level.value,
            "avg_speed_kmh": camera.avg_speed_kmh,
            "vehicle_count": tracking.vehicle_count,
            "moving_count": tracking.moving_count,
            "stopped_count": tracking.stopped_count,
            "parked_count": tracking.parked_count,
        },
        role_room(UserRole.POLICE.value),
    )



def _require_ingest_key(x_api_key: str) -> None:
    if not constant_time_equals(x_api_key, settings.ingest_api_key):
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_api_key", "Invalid API key.")


@router.post(
    "/ingest/detections",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["ingest"],
    summary="Video-analytics systems push detections here (X-API-Key)",
)
@limiter.limit("600/minute")
async def ingest(request: Request, body: DetectionIngest, x_api_key: Annotated[str, Header()]) -> JobAccepted:
    _require_ingest_key(x_api_key)
    # The worker drops detections below the alert threshold; say so now instead of accepting them silently.
    if body.confidence < MIN_CONFIDENCE:
        return JobAccepted(job_id="", status="ignored_low_confidence")
    payload = body.model_dump(mode="json", exclude={"snapshot_base64"})
    if body.snapshot_base64:
        try:
            data = base64.b64decode(body.snapshot_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_snapshot", "Snapshot is not valid base64.") from exc
        payload["snapshot_key"] = await asyncio.to_thread(storage.save_snapshot, data)
    job = ingest_detection.delay(payload)
    return JobAccepted(job_id=job.id)


@router.get(
    "/ingest/cameras/{camera_code}",
    response_model=DetectorConfig,
    tags=["ingest"],
    summary="AI detectors look up a camera's video source and mode (X-API-Key)",
)
@limiter.limit("60/minute")
async def detector_config(
    request: Request, camera_code: str, x_api_key: Annotated[str, Header()], db: DbSession
) -> DetectorConfig:
    _require_ingest_key(x_api_key)
    camera = await db.scalar(select(Camera).where(Camera.code == camera_code.upper()))
    if camera is None:
        raise AppError(status.HTTP_404_NOT_FOUND, "unknown_camera", "Unknown camera code.")
    parking = await db.get(ParkingLocation, camera.parking_id) if camera.parking_id else None
    return DetectorConfig(
        camera_code=camera.code,
        mode="parking" if camera.owner_id is not None else "traffic",
        source_url=camera.source_url,
        parking_name=parking.name if parking else None,
        capacity=parking.capacity if parking else None,
    )


@router.post(
    "/ingest/heartbeat",
    response_model=HeartbeatAccepted,
    tags=["ingest"],
    summary="AI detectors report that a camera is live; unknown camera codes are registered (X-API-Key)",
)
@limiter.limit("120/minute")
async def heartbeat(
    request: Request, body: CameraHeartbeat, x_api_key: Annotated[str, Header()], db: DbSession
) -> HeartbeatAccepted:
    _require_ingest_key(x_api_key)
    code = body.camera_code.upper()
    camera = await db.scalar(select(Camera).where(Camera.code == code).with_for_update())
    created = camera is None
    if camera is None:
        camera = Camera(
            code=code,
            name=body.name or f"Camera {code}",
            road=body.road or "Unspecified road",
            area=body.area or "Unassigned",
            zone=body.zone or "Mobile",
            latitude=body.latitude if body.latitude is not None else KATHMANDU_CENTER[0],
            longitude=body.longitude if body.longitude is not None else KATHMANDU_CENTER[1],
            status=CameraStatus.LIVE,
        )
        db.add(camera)
    else:
        for field in ("name", "road", "area", "zone", "latitude", "longitude"):
            value = getattr(body, field)
            if value is not None:
                setattr(camera, field, value)
        # Cameras under maintenance stay that way until an admin changes them.
        if camera.status == CameraStatus.OFFLINE:
            camera.status = CameraStatus.LIVE
    if body.stream_url is not None:
        camera.stream_url = body.stream_url
    now = datetime.now(UTC)
    camera.last_heartbeat_at = now
    camera.detector_seen_at = now
    await db.commit()
    return HeartbeatAccepted(camera_id=camera.id, camera_code=camera.code, created=created, status=camera.status)


@router.post(
    "/ingest/telemetry",
    response_model=TelemetryAccepted,
    tags=["ingest"],
    summary="AI detectors push live vehicle tracking and measured traffic for a camera (X-API-Key)",
)
@limiter.limit("600/minute")
async def telemetry(
    request: Request, body: TelemetryIngest, x_api_key: Annotated[str, Header()], db: DbSession
) -> TelemetryAccepted:
    _require_ingest_key(x_api_key)
    camera = await db.scalar(select(Camera).where(Camera.code == body.camera_code.upper()).with_for_update())
    if camera is None:
        raise AppError(
            status.HTTP_404_NOT_FOUND, "unknown_camera", "Unknown camera. Send a heartbeat first to register it."
        )
    now = datetime.now(UTC)
    camera.last_heartbeat_at = now
    camera.detector_seen_at = now
    if camera.status == CameraStatus.OFFLINE:
        camera.status = CameraStatus.LIVE
    # Traffic conditions come from the measured speed. Without one (camera not calibrated, or vehicles
    # not measurable yet) the last known condition is kept rather than guessed, and it ages: parking
    # enforcement treats an old measurement as unknown traffic.
    before = traffic_status(camera, now)
    flowing = sum(1 for t in body.tracks if t.status != "parked")
    level = measured_level(body.avg_speed_kmh, calibrated=body.speed_calibrated, flowing_vehicles=flowing)
    if level is not None:
        if body.avg_speed_kmh is not None:
            camera.avg_speed_kmh = round(body.avg_speed_kmh)
        camera.traffic_level = level
        camera.traffic_updated_at = now
    traffic_cleared = before != TrafficStatus.NORMAL_FLOW and traffic_status(camera, now) == TrafficStatus.NORMAL_FLOW
    result = TelemetryAccepted(
        camera_id=camera.id, traffic_level=camera.traffic_level, avg_speed_kmh=camera.avg_speed_kmh
    )
    availability = None
    if camera.parking_id is not None:
        parking = await db.scalar(
            select(ParkingLocation).where(ParkingLocation.id == camera.parking_id).with_for_update()
        )
        availability = await occupancy.apply_camera_report(parking, camera, body.tracks)
    await db.commit()
    if availability is not None:
        await emit("parking:update", availability)
    if traffic_cleared:
        # Vehicles held back during the jam (or while traffic was unknown) are judged again now.
        reassess_parking_task.delay(str(camera.id))

    tracking = CameraTracking(
        **body.model_dump(exclude={"camera_code", "captured_at", "speed_calibrated"}), updated_at=body.captured_at or now
    )
    await redis_client.set(tracking_key(result.camera_id), tracking.model_dump_json(), ex=TRACKING_TTL_SECONDS)
    await _broadcast_tracking(camera, tracking)
    return result


# An evaluation is queued at most this often per vehicle; keepalives arrive every few seconds.
EVALUATE_THROTTLE_SECONDS = 10


@router.post(
    "/ingest/parking-status",
    response_model=ParkingStatusAccepted,
    tags=["ingest"],
    summary="Parking Availability Bridge pushes PARKED / NOT_PARKED changes per vehicle (X-API-Key)",
)
@limiter.limit("600/minute")
async def parking_status(
    request: Request, body: ParkingStatusIngest, x_api_key: Annotated[str, Header()], db: DbSession
) -> ParkingStatusAccepted:
    _require_ingest_key(x_api_key)
    camera = await db.scalar(select(Camera).where(Camera.code == body.camera_code.upper()))
    if camera is None:
        raise AppError(
            status.HTTP_404_NOT_FOUND, "unknown_camera", "Unknown camera. Send a heartbeat first to register it."
        )
    now = datetime.now(UTC)
    counts = {"applied": 0, "keepalive": 0, "ignored": 0}
    to_evaluate: list[uuid.UUID] = []
    orphan_snapshots: list[str] = []
    for item in body.vehicles:
        snapshot_key = None
        if item.snapshot_base64 and item.state == ParkingState.PARKED:
            try:
                data = base64.b64decode(item.snapshot_base64, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise AppError(
                    status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_snapshot", "Snapshot is not valid base64."
                ) from exc
            snapshot_key = await asyncio.to_thread(storage.save_snapshot, data)
        outcome, vehicle = await parking_enforcement.apply_update(
            db,
            camera,
            bridge_id=body.bridge_id,
            violation_type=body.violation_type,
            update_in=item,
            snapshot_key=snapshot_key,
            now=now,
        )
        counts[outcome] += 1
        if snapshot_key and (vehicle is None or vehicle.snapshot_key != snapshot_key):
            orphan_snapshots.append(snapshot_key)  # repeat delivery: the first photo is kept
        if vehicle is not None and vehicle.state == ParkingState.PARKED and vehicle.alert_id is None:
            to_evaluate.append(vehicle.id)
    await db.commit()
    for key in orphan_snapshots:
        await asyncio.to_thread(storage.delete, key)
    for vehicle_id in to_evaluate:
        if await redis_client.set(f"parking:evaluate:{vehicle_id}", "1", nx=True, ex=EVALUATE_THROTTLE_SECONDS):
            evaluate_parked_vehicle_task.delay(str(vehicle_id))

    parked_rows = (
        await db.execute(
            select(ParkedVehicle.decision).where(
                ParkedVehicle.camera_id == camera.id, ParkedVehicle.state == ParkingState.PARKED
            )
        )
    ).scalars().all()
    return ParkingStatusAccepted(
        **counts,
        parked=len(parked_rows),
        suppressed=sum(1 for d in parked_rows if d in parking_enforcement.SUPPRESSED),
    )


@router.get(
    "/cameras/{camera_id}/parked-vehicles",
    response_model=list[ParkedVehicleOut],
    tags=["cameras"],
    summary="Vehicles the Parking Availability Bridge reports as parked, and the enforcement decision",
)
async def parked_vehicles(camera_id: uuid.UUID, _: PoliceUser, db: DbSession) -> list[ParkedVehicle]:
    rows = await db.scalars(
        select(ParkedVehicle)
        .where(ParkedVehicle.camera_id == camera_id, ParkedVehicle.state == ParkingState.PARKED)
        .order_by(ParkedVehicle.parked_since)
        .limit(100)
    )
    return list(rows)
