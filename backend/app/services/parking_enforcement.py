"""Traffic-aware illegal-parking alerts for vehicles reported by the Parking Availability Bridge.

The bridge reports PARKED / NOT_PARKED per vehicle. This module decides what happens next:

    Vehicle      Traffic       Action
    NOT_PARKED   any           no alert
    PARKED       NORMAL_FLOW   check the illegal-parking rules, alert if they all hold
    PARKED       TRAFFIC_JAM   hold the alert back (the vehicle may just be queued), unless other
                               vehicles are driving past it (evidence reason "traffic_passing"): then
                               it is probably causing the jam, so alert
    PARKED       unknown/old   check the illegal-parking rules, alert if they all hold

Traffic comes from the camera's existing traffic level (see services/traffic.py); nothing here measures
traffic. Held-back vehicles are reassessed whenever traffic returns to normal and periodically while
they stay parked. Traffic is read again, under a lock, immediately before an alert is created. A vehicle
is alerted at most once (unique `parked_vehicles.alert_id`, row lock, and a check for an open alert on
the same spot), and alerts then go through the existing publish + nearest-officer dispatch.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.enums import (
    OPEN_ALERT_STATUSES,
    CameraStatus,
    EnforcementDecision,
    ParkingState,
    TrafficStatus,
    ViolationType,
)
from app.models.monitoring import Alert, Camera, ParkedVehicle
from app.services.alerts_sync import MIN_CONFIDENCE, create_alert, publish_alert
from app.services.traffic import traffic_status

log = logging.getLogger(__name__)

# An open alert on the same camera this close (IoU) to a parked vehicle is that vehicle's alert.
SAME_VEHICLE_IOU = 0.5
SAME_VEHICLE_WINDOW = timedelta(hours=2)

# The bridge's evidence reason for a vehicle that other vehicles drove past while it stood still.
PASSING_TRAFFIC_REASON = "traffic_passing"

SUPPRESSED = {EnforcementDecision.SUPPRESSED_TRAFFIC_JAM, EnforcementDecision.SUPPRESSED_TRAFFIC_UNKNOWN}


def _iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


# --------------------------------------------------------------------------- the rules


def decide(vehicle: ParkedVehicle, camera: Camera, now: datetime) -> tuple[EnforcementDecision, TrafficStatus]:
    """What should happen to this vehicle right now. ALERTED means "every condition for an alert holds"."""
    traffic = traffic_status(camera, now)
    if vehicle.state != ParkingState.PARKED:
        return EnforcementDecision.NOT_PARKED, traffic
    if vehicle.alert_id is not None:
        return EnforcementDecision.ALERTED, traffic
    if now - vehicle.last_seen_at > timedelta(seconds=settings.parking_status_stale_seconds):
        return EnforcementDecision.NOT_OBSERVED, traffic
    # Illegal-parking rules: a police camera on a road (not one watching a parking facility, where
    # standing vehicles are customers), a confident detection, a camera that is in service.
    if camera.owner_id is not None or camera.parking_id is not None:
        return EnforcementDecision.LEGAL_PARKING, traffic
    if vehicle.confidence < MIN_CONFIDENCE:
        return EnforcementDecision.LOW_CONFIDENCE, traffic
    if camera.status == CameraStatus.MAINTENANCE:
        return EnforcementDecision.CAMERA_UNAVAILABLE, traffic
    # Only a measured jam holds the alert back; unknown or old traffic does not. A vehicle that other
    # traffic is driving around is not queued in the jam: it is most likely causing it, so it is alerted.
    if traffic == TrafficStatus.TRAFFIC_JAM and (vehicle.evidence or {}).get("reason") != PASSING_TRAFFIC_REASON:
        return EnforcementDecision.SUPPRESSED_TRAFFIC_JAM, traffic
    return EnforcementDecision.ALERTED, traffic


def _record(vehicle: ParkedVehicle, decision: EnforcementDecision, traffic: TrafficStatus, now: datetime) -> None:
    if vehicle.decision != decision or vehicle.traffic_status != traffic:
        vehicle.decided_at = now
    vehicle.decision = decision
    vehicle.traffic_status = traffic


def _open_alert_for_same_vehicle(session: Session, vehicle: ParkedVehicle, now: datetime) -> uuid.UUID | None:
    """The bridge restarted and gave a vehicle it already reported a new key: reuse that open alert."""
    rows = session.execute(
        select(ParkedVehicle.box, ParkedVehicle.alert_id)
        .join(Alert, Alert.id == ParkedVehicle.alert_id)
        .where(
            ParkedVehicle.camera_id == vehicle.camera_id,
            ParkedVehicle.id != vehicle.id,
            Alert.status.in_(OPEN_ALERT_STATUSES),
            Alert.detected_at >= now - SAME_VEHICLE_WINDOW,
        )
    ).all()
    for box, alert_id in rows:
        if _iou(list(box), list(vehicle.box)) >= SAME_VEHICLE_IOU:
            return alert_id
    return None


def evaluate(session: Session, vehicle_id: uuid.UUID) -> EnforcementDecision | None:
    """Assess one vehicle and raise its alert when every condition holds. Safe to call repeatedly."""
    from app.worker.tasks import dispatch_alert_task  # tasks imports this module

    vehicle = session.scalar(
        select(ParkedVehicle)
        .where(ParkedVehicle.id == vehicle_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if vehicle is None:
        return None
    camera = session.scalar(
        select(Camera).where(Camera.id == vehicle.camera_id).execution_options(populate_existing=True)
    )
    if camera is None:
        return None
    now = datetime.now(UTC)
    decision, traffic = decide(vehicle, camera, now)
    if decision != EnforcementDecision.ALERTED or vehicle.alert_id is not None:
        _record(vehicle, decision, traffic, now)
        session.commit()
        return decision

    # Re-read traffic immediately before alerting. The share lock waits for a telemetry update that is
    # changing this camera's traffic right now, so the alert never goes out on a level that just changed.
    camera = session.scalar(
        select(Camera)
        .where(Camera.id == vehicle.camera_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    now = datetime.now(UTC)
    decision, traffic = decide(vehicle, camera, now)
    _record(vehicle, decision, traffic, now)
    if decision != EnforcementDecision.ALERTED:
        session.commit()
        return decision

    existing = _open_alert_for_same_vehicle(session, vehicle, now)
    if existing is not None:
        vehicle.alert_id = existing
        session.commit()
        return EnforcementDecision.ALERTED

    alert = create_alert(
        session,
        camera,
        violation_type=vehicle.violation_type,
        vehicle_type=vehicle.vehicle_type,
        plate_number=None,
        confidence=vehicle.confidence,
        detected_at=vehicle.parked_since or now,
        snapshot_key=vehicle.snapshot_key,
    )
    vehicle.alert_id = alert.id
    session.commit()
    log.info(
        "Illegal parking alert %s for vehicle %s on %s (traffic %s)",
        alert.code,
        vehicle.vehicle_key,
        camera.code,
        traffic,
    )
    publish_alert(alert, camera)
    dispatch_alert_task.delay(str(alert.id))
    return EnforcementDecision.ALERTED


def release_stale(session: Session) -> int:
    """Parked vehicles the bridge stopped reporting are no longer observed; they are never alerted."""
    now = datetime.now(UTC)
    result = session.execute(
        update(ParkedVehicle)
        .where(
            ParkedVehicle.state == ParkingState.PARKED,
            ParkedVehicle.last_seen_at < now - timedelta(seconds=settings.parking_status_stale_seconds),
        )
        .values(
            state=ParkingState.NOT_PARKED,
            ended_at=now,
            decision=EnforcementDecision.NOT_OBSERVED,
            decided_at=now,
        )
    )
    session.commit()
    return result.rowcount or 0


def reassess(session: Session, camera_id: uuid.UUID | None = None) -> int:
    """Re-run the rules for every parked vehicle still waiting for an alert. Returns alerts raised."""
    release_stale(session)
    stmt = select(ParkedVehicle.id).where(ParkedVehicle.state == ParkingState.PARKED, ParkedVehicle.alert_id.is_(None))
    if camera_id is not None:
        stmt = stmt.where(ParkedVehicle.camera_id == camera_id)
    ids = session.scalars(stmt.order_by(ParkedVehicle.parked_since)).all()
    return sum(1 for vid in ids if evaluate(session, vid) == EnforcementDecision.ALERTED)


# --------------------------------------------------------------------------- bridge updates (API side)


async def apply_update(
    db: AsyncSession,
    camera: Camera,
    *,
    bridge_id: str,
    violation_type: ViolationType,
    update_in: "ParkingStatusUpdate",  # noqa: F821 - schema imported lazily to avoid a cycle
    snapshot_key: str | None,
    now: datetime,
) -> tuple[str, ParkedVehicle | None]:
    """Applies one bridge update. Returns ("applied" | "keepalive" | "ignored", vehicle row).

    Sequence numbers make this idempotent: a repeat refreshes `last_seen_at` only, an older update is
    ignored, so duplicated or reordered deliveries can never move a vehicle back to an earlier state.
    """
    if update_in.state == ParkingState.PARKED:
        await db.execute(
            pg_insert(ParkedVehicle)
            .values(
                id=uuid.uuid4(),
                camera_id=camera.id,
                vehicle_key=update_in.vehicle_key,
                bridge_id=bridge_id,
                track_id=update_in.track_id,
                state=ParkingState.NOT_PARKED,
                last_seq=0,
                vehicle_type=update_in.vehicle_type,
                confidence=update_in.confidence,
                box=list(update_in.box),
                violation_type=violation_type,
                last_seen_at=now,
                evidence={},
                decision=EnforcementDecision.PENDING,
            )
            .on_conflict_do_nothing(index_elements=["vehicle_key"])
        )
    vehicle = await db.scalar(
        select(ParkedVehicle)
        .where(ParkedVehicle.vehicle_key == update_in.vehicle_key)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if vehicle is None or vehicle.camera_id != camera.id:
        return "ignored", None  # NOT_PARKED for a vehicle never reported parked, or a foreign key
    if update_in.seq < vehicle.last_seq:
        return "ignored", vehicle
    vehicle.last_seen_at = now
    vehicle.box = list(update_in.box)
    vehicle.track_id = update_in.track_id
    if update_in.seq == vehicle.last_seq:
        return "keepalive", vehicle
    vehicle.last_seq = update_in.seq
    vehicle.state = update_in.state
    vehicle.vehicle_type = update_in.vehicle_type
    vehicle.confidence = update_in.confidence
    vehicle.evidence = {**update_in.evidence, "stationary_seconds": update_in.stationary_seconds}
    if update_in.state == ParkingState.PARKED:
        vehicle.parked_since = update_in.changed_at - timedelta(seconds=update_in.stationary_seconds)
        vehicle.ended_at = None
        vehicle.decision = EnforcementDecision.PENDING
        if snapshot_key and vehicle.snapshot_key is None:
            vehicle.snapshot_key = snapshot_key
    else:
        vehicle.ended_at = now
        if vehicle.alert_id is None:
            vehicle.decision = EnforcementDecision.NOT_PARKED
            vehicle.decided_at = now
    return "applied", vehicle
