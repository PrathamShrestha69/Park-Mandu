"""Synchronous alert helpers shared by Celery tasks and the seed script."""

import json
import random
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.redis import ALERTS_CHANNEL, sync_redis
from app.models.enums import AlertSeverity, ViolationType
from app.models.monitoring import Alert, Camera
from app.schemas.monitoring import VIOLATION_LABELS

SEVERITY_BY_VIOLATION = {
    ViolationType.RESTRICTED_LANE: AlertSeverity.HIGH,
    ViolationType.NEAR_INTERSECTION: AlertSeverity.HIGH,
    ViolationType.BUS_STOP: AlertSeverity.HIGH,
    ViolationType.DOUBLE_PARKING: AlertSeverity.HIGH,
    ViolationType.NO_PARKING_ZONE: AlertSeverity.MEDIUM,
    ViolationType.FOOTPATH: AlertSeverity.MEDIUM,
    ViolationType.OVERTIME: AlertSeverity.LOW,
    ViolationType.LOADING_ZONE: AlertSeverity.LOW,
}

VEHICLES = [
    ("Car", "Cha"),
    ("SUV", "Cha"),
    ("Taxi", "Ja"),
    ("Motorbike", "Pa"),
    ("Microbus", "Kha"),
    ("Delivery van", "Kha"),
    ("Pickup truck", "Ga"),
]
COLORS = ["White", "Silver", "Black", "Red", "Blue", "Grey", "Maroon"]
DIRECTIONS = ["Northbound", "Southbound", "Eastbound", "Westbound"]
MIN_CONFIDENCE = 0.6


def random_plate(series: str) -> str:
    return f"Ba {random.randint(1, 99)} {series} {random.randint(1000, 9999)}"


def create_alert(
    session: Session,
    camera: Camera,
    *,
    violation_type: ViolationType,
    vehicle_type: str,
    plate_number: str | None,
    confidence: float,
    vehicle_color: str | None = None,
    direction: str | None = None,
    detected_at: datetime | None = None,
    snapshot_key: str | None = None,
) -> Alert:
    # Small jitter so simultaneous detections on one camera do not stack on the same map pixel.
    alert = Alert(
        camera_id=camera.id,
        violation_type=violation_type,
        severity=SEVERITY_BY_VIOLATION[violation_type],
        vehicle_type=vehicle_type,
        vehicle_color=vehicle_color,
        plate_number=plate_number,
        confidence=round(confidence, 3),
        direction=direction,
        detected_at=detected_at or datetime.now(UTC),
        snapshot_key=snapshot_key,
        latitude=camera.latitude + random.uniform(-0.0004, 0.0004),
        longitude=camera.longitude + random.uniform(-0.0004, 0.0004),
    )
    alert.camera = camera
    session.add(alert)
    session.flush()
    alert.code = f"ALT-{alert.seq}"
    return alert


def publish_alert(alert: Alert, camera: Camera) -> None:
    sync_redis.publish(
        ALERTS_CHANNEL,
        json.dumps(
            {
                "id": str(alert.id),
                "code": alert.code,
                "severity": alert.severity.value,
                "violation_label": VIOLATION_LABELS[alert.violation_type],
                "camera_code": camera.code,
                "road": camera.road,
                "area": camera.area,
                "plate_number": alert.plate_number,
                "detected_at": alert.detected_at.isoformat(),
            }
        ),
    )
