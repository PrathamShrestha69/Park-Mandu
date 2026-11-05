import logging
import random
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import delete, func, or_, select, update

from app.core.config import settings
from app.core.redis import sync_redis
from app.db.session import SyncSessionLocal
from app.models.application import ApplicationDocument
from app.models.enums import (
    AlertSeverity,
    AlertStatus,
    CameraStatus,
    DocumentStatus,
    NotificationKind,
    NotificationTone,
    TrafficLevel,
    ViolationType,
)
from app.models.monitoring import Alert, Camera
from app.models.notification import DeviceToken, Notification
from app.models.user import AuthSession
from app.services import storage
from app.services.alerts_sync import (
    COLORS,
    DIRECTIONS,
    MIN_CONFIDENCE,
    VEHICLES,
    create_alert,
    publish_alert,
    random_plate,
)
from app.worker.celery_app import celery_app

log = logging.getLogger(__name__)

THUMBNAIL_SIZE = (480, 480)
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


# --------------------------------------------------------------------------- notifications


@celery_app.task(autoretry_for=(httpx.HTTPError,), retry_backoff=True, max_retries=5)
def send_sms(phone: str, message: str) -> None:
    """SMS gateway integration point. In development the message is only logged."""
    log.info("SMS to %s: %s", phone, message if settings.expose_dev_codes else "<redacted>")


@celery_app.task(autoretry_for=(httpx.HTTPError,), retry_backoff=True, max_retries=5)
def send_notification(
    user_id: str,
    kind: str,
    tone: str,
    title: str,
    body: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> str:
    with SyncSessionLocal() as session:
        notification = Notification(
            user_id=uuid.UUID(user_id),
            kind=NotificationKind(kind),
            tone=NotificationTone(tone),
            title=title,
            body=body,
            entity_type=entity_type,
            entity_id=uuid.UUID(entity_id) if entity_id else None,
        )
        session.add(notification)
        session.commit()
        tokens = session.scalars(select(DeviceToken.token).where(DeviceToken.user_id == uuid.UUID(user_id))).all()

    if settings.expo_push_enabled and tokens:
        messages = [
            {
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
                "data": {"entity_type": entity_type, "entity_id": entity_id},
            }
            for token in tokens
        ]
        httpx.post(EXPO_PUSH_URL, json=messages, timeout=10).raise_for_status()
    return str(notification.id)


def notify(
    user_id: uuid.UUID,
    kind: NotificationKind,
    tone: NotificationTone,
    title: str,
    body: str,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
) -> None:
    """Enqueue a notification. Call only after the triggering transaction has committed."""
    send_notification.delay(
        str(user_id), kind.value, tone.value, title, body, entity_type, str(entity_id) if entity_id else None
    )


# --------------------------------------------------------------------------- documents


@celery_app.task(bind=True, max_retries=3, default_retry_delay=10)
def process_document(self: Any, document_id: str) -> str:
    """Strips photo metadata (GPS/EXIF), normalises orientation and builds a WEBP thumbnail."""
    with SyncSessionLocal() as session:
        doc = session.get(ApplicationDocument, uuid.UUID(document_id))
        if doc is None:
            return "missing"
        if not doc.content_type.startswith("image/"):
            doc.status = DocumentStatus.READY
            session.commit()
            return "ready"
        try:
            path = storage.resolve(doc.storage_key)
            with Image.open(path) as original:
                fmt = original.format or "JPEG"
                img = ImageOps.exif_transpose(original)
                clean = img.convert("RGB") if img.mode not in ("RGB", "L") else img.copy()
                clean.save(path, format=fmt, quality=88)
                thumb_key = doc.storage_key.rsplit(".", 1)[0] + "_thumb.webp"
                clean.thumbnail(THUMBNAIL_SIZE)
                clean.save(storage.resolve(thumb_key), format="WEBP", quality=80)
            doc.thumbnail_key = thumb_key
            doc.status = DocumentStatus.READY
        except (UnidentifiedImageError, OSError) as exc:
            log.warning("Document %s failed processing: %s", document_id, exc)
            doc.status = DocumentStatus.FAILED
        session.commit()
        return doc.status.value


# --------------------------------------------------------------------------- monitoring


@celery_app.task
def ingest_detection(payload: dict[str, Any]) -> str | None:
    """Creates an alert from an external video-analytics detection, de-duplicating repeat sightings."""
    snapshot_key = payload.get("snapshot_key")

    def discard() -> None:
        storage.delete(snapshot_key)
        return None

    if payload["confidence"] < MIN_CONFIDENCE:
        return discard()
    plate = payload.get("plate_number")
    if plate:
        dedupe_key = f"detections:dedupe:{payload['camera_code']}:{plate}:{payload['violation_type']}"
        if not sync_redis.set(dedupe_key, "1", nx=True, ex=600):
            return discard()
    with SyncSessionLocal() as session:
        camera = session.scalar(select(Camera).where(Camera.code == payload["camera_code"].upper()))
        if camera is None:
            log.warning("Detection for unknown camera %s", payload["camera_code"])
            return discard()
        detected_at = payload.get("detected_at")
        alert = create_alert(
            session,
            camera,
            violation_type=ViolationType(payload["violation_type"]),
            vehicle_type=payload["vehicle_type"],
            vehicle_color=payload.get("vehicle_color"),
            plate_number=plate,
            confidence=payload["confidence"],
            direction=payload.get("direction"),
            detected_at=datetime.fromisoformat(detected_at) if detected_at else None,
            snapshot_key=snapshot_key,
        )
        session.commit()
        publish_alert(alert, camera)
        return str(alert.id)


@celery_app.task
def simulate_camera_telemetry() -> int:
    """Demo stand-in for camera heartbeats and traffic analytics. Always marks silent cameras offline."""
    now = datetime.now(UTC)
    if not settings.simulate_detections:
        # Real detectors heartbeat via POST /ingest/heartbeat; only the offline sweep runs.
        with SyncSessionLocal() as session:
            session.execute(
                update(Camera)
                .where(
                    Camera.status == CameraStatus.LIVE,
                    or_(Camera.last_heartbeat_at.is_(None), Camera.last_heartbeat_at < now - timedelta(minutes=2)),
                )
                .values(status=CameraStatus.OFFLINE)
            )
            session.commit()
        return 0
    with SyncSessionLocal() as session:
        cameras = session.scalars(select(Camera).where(Camera.status == CameraStatus.LIVE)).all()
        for camera in cameras:
            camera.last_heartbeat_at = now
            if random.random() < 0.35:
                level = random.choices(list(TrafficLevel), weights=[45, 30, 17, 8])[0]
                speed = {"clear": (28, 42), "moderate": (18, 28), "slow": (8, 18), "congested": (2, 8)}[level.value]
                camera.traffic_level = level
                camera.avg_speed_kmh = random.randint(*speed)
        # Cameras that stop sending heartbeats are marked offline.
        session.execute(
            update(Camera)
            .where(Camera.status == CameraStatus.LIVE, Camera.last_heartbeat_at < now - timedelta(minutes=10))
            .values(status=CameraStatus.OFFLINE)
        )
        session.commit()
        return len(cameras)


@celery_app.task
def simulate_detection() -> str | None:
    """Demo stand-in for video analytics: occasionally raises an illegal-parking detection."""
    if not settings.simulate_detections or random.random() > 0.55:
        return None
    with SyncSessionLocal() as session:
        camera = session.scalar(
            select(Camera).where(Camera.status == CameraStatus.LIVE).order_by(func.random()).limit(1)
        )
        if camera is None:
            return None
        vehicle_type, series = random.choice(VEHICLES)
        alert = create_alert(
            session,
            camera,
            violation_type=random.choices(list(ViolationType), weights=[18, 16, 14, 12, 12, 10, 10, 8])[0],
            vehicle_type=vehicle_type,
            vehicle_color=random.choice(COLORS),
            plate_number=random_plate(series) if random.random() > 0.08 else None,
            confidence=random.uniform(0.72, 0.98),
            direction=random.choice(DIRECTIONS),
        )
        session.commit()
        publish_alert(alert, camera)
        return str(alert.id)


@celery_app.task
def escalate_stale_alerts() -> int:
    """Raises priority of alerts nobody picked up, and auto-closes very old unattended ones."""
    now = datetime.now(UTC)
    with SyncSessionLocal() as session:
        escalated = session.execute(
            update(Alert)
            .where(
                Alert.status == AlertStatus.ACTIVE,
                Alert.severity != AlertSeverity.HIGH,
                Alert.detected_at < now - timedelta(minutes=30),
            )
            .values(severity=AlertSeverity.HIGH)
        ).rowcount
        session.execute(
            update(Alert)
            .where(Alert.status == AlertStatus.ACTIVE, Alert.detected_at < now - timedelta(hours=8))
            .values(
                status=AlertStatus.DISMISSED, closed_at=now, dismiss_reason="Auto-closed: no response within 8 hours"
            )
        )
        session.commit()
        return escalated or 0


@celery_app.task
def purge_expired_sessions() -> int:
    with SyncSessionLocal() as session:
        removed = session.execute(
            delete(AuthSession).where(AuthSession.expires_at < datetime.now(UTC) - timedelta(days=1))
        ).rowcount
        session.commit()
        return removed or 0
