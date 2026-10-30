from celery import Celery
from kombu import Queue

from app.core.config import settings

celery_app = Celery(
    "parkmandu",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.worker.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    result_expires=3600,
    timezone=settings.timezone,
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    task_default_queue="default",
    task_queues=(
        Queue("default"),
        Queue("media"),
        Queue("notifications"),
        Queue("monitoring"),
    ),
    task_routes={
        "app.worker.tasks.process_document": {"queue": "media"},
        "app.worker.tasks.send_notification": {"queue": "notifications"},
        "app.worker.tasks.send_sms": {"queue": "notifications"},
        "app.worker.tasks.ingest_detection": {"queue": "monitoring"},
        "app.worker.tasks.simulate_camera_telemetry": {"queue": "monitoring"},
        "app.worker.tasks.simulate_detection": {"queue": "monitoring"},
        "app.worker.tasks.escalate_stale_alerts": {"queue": "monitoring"},
    },
    beat_schedule={
        "camera-telemetry": {"task": "app.worker.tasks.simulate_camera_telemetry", "schedule": 30.0},
        "cctv-detections": {"task": "app.worker.tasks.simulate_detection", "schedule": 45.0},
        "escalate-stale-alerts": {"task": "app.worker.tasks.escalate_stale_alerts", "schedule": 60.0},
        "purge-expired-sessions": {"task": "app.worker.tasks.purge_expired_sessions", "schedule": 6 * 3600.0},
    },
)
