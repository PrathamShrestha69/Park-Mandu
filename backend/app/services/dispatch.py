"""Sends an incident to the single nearest available traffic officer within the dispatch radius.

Rules this module guarantees:
  * only one officer is ever notified for an alert (one `alert_dispatches` row per alert),
  * only on-duty officers with a recent position and no unfinished job are considered,
  * nobody outside `settings.dispatch_radius_m` is notified; if there is nobody, the alert is
    marked NO_OFFICER and the control room is told instead,
  * an officer who declines (or does not answer in time) is skipped and the next nearest is tried.
"""

import logging
import math
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.realtime import emit_sync, role_room, user_room
from app.models.enums import (
    OPEN_ALERT_STATUSES,
    AlertStatus,
    DispatchStatus,
    IncidentStatus,
    NotificationKind,
    NotificationTone,
    UserRole,
    UserStatus,
)
from app.models.monitoring import Alert, AlertDispatch, Camera, Incident
from app.models.user import User
from app.schemas.monitoring import VIOLATION_LABELS

log = logging.getLogger(__name__)

# An officer who has not answered after this long is treated as unavailable and the next one is tried.
RESPONSE_TIMEOUT = timedelta(minutes=3)
# Alerts older than this are no longer worth sending anybody to.
RETRY_WINDOW = timedelta(minutes=30)
NO_OFFICER_MESSAGE = "No traffic officer is available within {km:g} km of this incident."


@dataclass(frozen=True)
class Candidate:
    officer_id: uuid.UUID
    distance_m: float


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6_371_008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def choose_nearest(
    candidates: list[Candidate], radius_m: float, excluded: set[uuid.UUID] | None = None
) -> Candidate | None:
    """The closest candidate inside the radius, or None. Ties go to the lowest id so the choice is stable."""
    skip = excluded or set()
    eligible = [c for c in candidates if c.distance_m <= radius_m and c.officer_id not in skip]
    return min(eligible, key=lambda c: (c.distance_m, str(c.officer_id)), default=None)


def nearby_officers(session: Session, latitude: float, longitude: float) -> list[Candidate]:
    """Available officers inside the dispatch radius, nearest first."""
    fresh = datetime.now(UTC) - timedelta(seconds=settings.officer_location_ttl_seconds)
    origin = func.geography(func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326))
    position = func.geography(func.ST_SetSRID(func.ST_MakePoint(User.longitude, User.latitude), 4326))
    distance = func.ST_Distance(position, origin).label("distance_m")

    # Already working an incident, or holding a call-out they have not finished: not available.
    on_incident = select(Incident.officer_id).where(Incident.status == IncidentStatus.IN_PROGRESS)
    on_call = (
        select(AlertDispatch.officer_id)
        .join(Alert, Alert.id == AlertDispatch.alert_id)
        .where(
            AlertDispatch.officer_id.is_not(None),
            AlertDispatch.status.in_([DispatchStatus.NOTIFIED, DispatchStatus.ACKNOWLEDGED]),
            Alert.status.in_(OPEN_ALERT_STATUSES),
        )
    )
    stmt = (
        select(User.id, distance)
        .where(
            User.role == UserRole.POLICE,
            User.status == UserStatus.ACTIVE,
            User.on_duty.is_(True),
            User.latitude.is_not(None),
            User.longitude.is_not(None),
            User.location_updated_at >= fresh,
            func.ST_DWithin(position, origin, settings.dispatch_radius_m),
            User.id.not_in(on_incident),
            User.id.not_in(on_call),
        )
        .order_by(distance.asc(), User.id)
    )
    return [Candidate(row.id, float(row.distance_m)) for row in session.execute(stmt)]


def alert_payload(alert: Alert, camera: Camera, distance_m: float | None = None) -> dict[str, object]:
    return {
        "alert_id": str(alert.id),
        "code": alert.code,
        "violation_type": alert.violation_type.value,
        "violation_label": VIOLATION_LABELS[alert.violation_type],
        "severity": alert.severity.value,
        "road": camera.road,
        "area": camera.area,
        "camera_code": camera.code,
        "latitude": alert.latitude,
        "longitude": alert.longitude,
        "vehicle_type": alert.vehicle_type,
        "plate_number": alert.plate_number,
        "detected_at": alert.detected_at.isoformat(),
        "distance_m": round(distance_m) if distance_m is not None else None,
    }


def _claim_row(session: Session, alert_id: uuid.UUID) -> AlertDispatch:
    """The alert's single dispatch row, created race-safely (unique alert_id) and locked."""
    session.execute(
        pg_insert(AlertDispatch)
        .values(id=uuid.uuid4(), alert_id=alert_id, status=DispatchStatus.NO_OFFICER, declined_officer_ids=[])
        .on_conflict_do_nothing(index_elements=["alert_id"])
    )
    row = session.scalar(
        select(AlertDispatch)
        .where(AlertDispatch.alert_id == alert_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert row is not None
    return row


def dispatch_alert(session: Session, alert_id: uuid.UUID) -> DispatchStatus | None:
    """Notify the nearest available officer for an alert.

    Safe to call repeatedly (retries, duplicate tasks): a row already notified or acknowledged is
    left alone, so one incident never produces a second notification.
    """
    from app.worker.tasks import notify  # imported here because tasks imports this module

    alert = session.get(Alert, alert_id)
    if alert is None or alert.status != AlertStatus.ACTIVE:
        return None
    camera = session.get(Camera, alert.camera_id)
    if camera is None:
        return None

    dispatch = _claim_row(session, alert_id)
    if dispatch.status in (DispatchStatus.NOTIFIED, DispatchStatus.ACKNOWLEDGED):
        session.commit()
        return dispatch.status

    declined = {uuid.UUID(x) for x in dispatch.declined_officer_ids}
    chosen = choose_nearest(
        nearby_officers(session, alert.latitude, alert.longitude), settings.dispatch_radius_m, declined
    )
    payload = alert_payload(alert, camera, chosen.distance_m if chosen else None)

    if chosen is None:
        first_time = dispatch.notified_at is None  # tells the control room once, not on every retry
        dispatch.status = DispatchStatus.NO_OFFICER
        dispatch.officer_id = None
        dispatch.distance_m = None
        dispatch.notified_at = dispatch.notified_at or datetime.now(UTC)
        session.commit()
        if first_time:
            message = NO_OFFICER_MESSAGE.format(km=settings.dispatch_radius_m / 1000)
            for role in (UserRole.POLICE, UserRole.ADMIN):
                emit_sync("dispatch:none", {**payload, "message": message}, role_room(role.value))
        return DispatchStatus.NO_OFFICER

    dispatch.officer_id = chosen.officer_id
    dispatch.distance_m = chosen.distance_m
    dispatch.status = DispatchStatus.NOTIFIED
    dispatch.notified_at = datetime.now(UTC)
    dispatch.responded_at = None
    session.commit()

    vehicle = f"{alert.vehicle_type} {alert.plate_number}" if alert.plate_number else alert.vehicle_type
    notify(
        chosen.officer_id,
        NotificationKind.INCIDENT_DISPATCH,
        NotificationTone.DANGER if alert.severity.value == "high" else NotificationTone.WARNING,
        f"{payload['violation_label']} · {camera.road}",
        f"{round(chosen.distance_m)} m from you. {vehicle}. "
        f"Detected {alert.detected_at.astimezone(UTC):%H:%M} UTC. Please acknowledge.",
        "alert",
        alert.id,
    )
    emit_sync("dispatch:assigned", payload, user_room(chosen.officer_id))
    for role in (UserRole.POLICE, UserRole.ADMIN):
        emit_sync("dispatch:update", {"alert_id": str(alert.id), "status": "notified"}, role_room(role.value))
    return DispatchStatus.NOTIFIED


def retry_pending(session: Session) -> int:
    """Re-dispatch alerts nobody has answered.

    Officers who timed out are skipped from then on, and a call-out that found nobody is retried as
    officers move into range. Returns how many alerts reached a new officer.
    """
    now = datetime.now(UTC)
    expired = session.scalars(
        select(AlertDispatch)
        .where(AlertDispatch.status == DispatchStatus.NOTIFIED, AlertDispatch.notified_at < now - RESPONSE_TIMEOUT)
        .with_for_update(skip_locked=True)
    ).all()
    for row in expired:
        if row.officer_id is not None:
            row.declined_officer_ids = [*row.declined_officer_ids, str(row.officer_id)]
        row.status = DispatchStatus.EXPIRED
        row.officer_id = None
    session.commit()

    retry_ids = session.scalars(
        select(AlertDispatch.alert_id)
        .join(Alert, Alert.id == AlertDispatch.alert_id)
        .where(
            AlertDispatch.status.in_([DispatchStatus.EXPIRED, DispatchStatus.DECLINED, DispatchStatus.NO_OFFICER]),
            Alert.status == AlertStatus.ACTIVE,
            Alert.detected_at >= now - RETRY_WINDOW,
        )
    ).all()
    return sum(1 for alert_id in retry_ids if dispatch_alert(session, alert_id) == DispatchStatus.NOTIFIED)


def record_response(
    session: Session, alert_id: uuid.UUID, officer_id: uuid.UUID, *, accepted: bool
) -> AlertDispatch | None:
    """The notified officer accepts or declines. Returns None when this officer is not the one notified."""
    row = session.scalar(select(AlertDispatch).where(AlertDispatch.alert_id == alert_id).with_for_update())
    if row is None or row.officer_id != officer_id or row.status != DispatchStatus.NOTIFIED:
        return None
    row.responded_at = datetime.now(UTC)
    if accepted:
        row.status = DispatchStatus.ACKNOWLEDGED
    else:
        row.declined_officer_ids = [*row.declined_officer_ids, str(officer_id)]
        row.status = DispatchStatus.DECLINED
        row.notified_at = None  # so the control room hears about it if nobody else is in range
    session.commit()
    return row
