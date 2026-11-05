from sqlalchemy import Select, case, select
from sqlalchemy.orm import selectinload

from app.models.enums import AlertSeverity
from app.models.monitoring import Alert, Incident, IncidentNote
from app.schemas.monitoring import VIOLATION_LABELS, AlertOut, IncidentDetail, IncidentSummary

SEVERITY_ORDER = case(
    (Alert.severity == AlertSeverity.HIGH, 0),
    (Alert.severity == AlertSeverity.MEDIUM, 1),
    else_=2,
)


def alert_query() -> Select[tuple[Alert]]:
    return select(Alert).options(
        selectinload(Alert.camera),
        selectinload(Alert.assigned_officer),
        selectinload(Alert.incident),
    )


def incident_query() -> Select[tuple[Incident]]:
    return select(Incident).options(
        selectinload(Incident.officer),
        selectinload(Incident.alert).selectinload(Alert.camera),
        selectinload(Incident.alert).selectinload(Alert.assigned_officer),
        selectinload(Incident.alert).selectinload(Alert.incident),
        selectinload(Incident.notes).selectinload(IncidentNote.author),
    )


def alert_to_out(alert: Alert) -> AlertOut:
    return AlertOut.model_validate(alert_dict(alert))


def alert_dict(alert: Alert) -> dict[str, object]:
    return {
        "id": alert.id,
        "code": alert.code,
        "camera_id": alert.camera_id,
        "camera_code": alert.camera.code,
        "camera_name": alert.camera.name,
        "road": alert.camera.road,
        "area": alert.camera.area,
        "violation_type": alert.violation_type,
        "violation_label": VIOLATION_LABELS[alert.violation_type],
        "severity": alert.severity,
        "status": alert.status,
        "vehicle_type": alert.vehicle_type,
        "vehicle_color": alert.vehicle_color,
        "plate_number": alert.plate_number,
        "confidence": alert.confidence,
        "direction": alert.direction,
        "detected_at": alert.detected_at,
        "latitude": alert.latitude,
        "longitude": alert.longitude,
        "assigned_officer_name": alert.assigned_officer.full_name if alert.assigned_officer else None,
        "incident_id": alert.incident.id if alert.incident else None,
        "closed_at": alert.closed_at,
        "dismiss_reason": alert.dismiss_reason,
        "has_snapshot": alert.snapshot_key is not None,
    }


def _incident_summary_dict(incident: Incident) -> dict[str, object]:
    alert = incident.alert
    return {
        "id": incident.id,
        "code": incident.code,
        "status": incident.status,
        "officer_id": incident.officer_id,
        "officer_name": incident.officer.full_name,
        "violation_label": VIOLATION_LABELS[alert.violation_type],
        "severity": alert.severity,
        "road": alert.camera.road,
        "camera_code": alert.camera.code,
        "plate_number": alert.plate_number,
        "created_at": incident.created_at,
        "resolved_at": incident.resolved_at,
    }


def incident_to_summary(incident: Incident) -> IncidentSummary:
    return IncidentSummary.model_validate(_incident_summary_dict(incident))


def incident_to_detail(incident: Incident) -> IncidentDetail:
    return IncidentDetail.model_validate(
        {
            **_incident_summary_dict(incident),
            "resolution": incident.resolution,
            "alert": alert_dict(incident.alert),
            "notes": [
                {"id": n.id, "body": n.body, "author_name": n.author.full_name, "created_at": n.created_at}
                for n in incident.notes
            ],
        }
    )
