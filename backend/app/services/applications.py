from sqlalchemy import Select, select
from sqlalchemy.orm import selectinload

from app.models.application import ApplicationDocument, ApplicationEvent, ParkingApplication
from app.models.enums import REQUIRED_DOCUMENT_KINDS, DocumentStatus
from app.schemas.application import ApplicationDetail, ApplicationSummary

STEP_LABELS = {
    "location": "Location on map",
    "property": "Property details",
    "owner": "Owner information",
}


def with_relations(stmt: Select[tuple[ParkingApplication]]) -> Select[tuple[ParkingApplication]]:
    return stmt.options(
        selectinload(ParkingApplication.applicant),
        selectinload(ParkingApplication.documents),
    )


def detail_query() -> Select[tuple[ParkingApplication]]:
    return select(ParkingApplication).options(
        selectinload(ParkingApplication.applicant),
        selectinload(ParkingApplication.reviewer),
        selectinload(ParkingApplication.documents),
        selectinload(ParkingApplication.events).selectinload(ApplicationEvent.actor),
    )


def missing_requirements(app: ParkingApplication) -> list[str]:
    missing: list[str] = []
    if app.latitude is None or app.longitude is None or not app.address:
        missing.append("location")
    if not all(
        [
            app.property_name,
            app.capacity,
            app.parking_type,
            app.opens_at,
            app.closes_at,
            app.available_days,
            app.pricing_mode,
        ]
    ):
        missing.append("property")
    if not all(
        [app.owner_name, app.owner_phone, app.gov_id_encrypted, app.ownership_document_number, app.owner_confirmed]
    ):
        missing.append("owner")
    uploaded = {doc.kind for doc in app.documents if doc.status != DocumentStatus.FAILED}
    missing.extend(f"document:{kind.value}" for kind in sorted(REQUIRED_DOCUMENT_KINDS) if kind not in uploaded)
    return missing


def document_out(doc: ApplicationDocument) -> dict[str, object]:
    return {
        "id": doc.id,
        "kind": doc.kind,
        "original_name": doc.original_name,
        "content_type": doc.content_type,
        "size_bytes": doc.size_bytes,
        "status": doc.status,
        "has_thumbnail": doc.thumbnail_key is not None,
        "created_at": doc.created_at,
    }


def to_summary(app: ParkingApplication) -> ApplicationSummary:
    return ApplicationSummary.model_validate(_summary_dict(app))


def _summary_dict(app: ParkingApplication) -> dict[str, object]:
    return {
        "id": app.id,
        "reference": app.reference,
        "status": app.status,
        "property_name": app.property_name,
        "address": app.address,
        "area": app.area,
        "capacity": app.capacity,
        "completed_step": app.completed_step,
        "applicant_name": app.applicant.full_name,
        "document_count": len(app.documents),
        "submitted_at": app.submitted_at,
        "created_at": app.created_at,
        "updated_at": app.updated_at,
    }


def to_detail(app: ParkingApplication, parking_location_id: object = None) -> ApplicationDetail:
    return ApplicationDetail.model_validate(
        {
            **_summary_dict(app),
            "latitude": app.latitude,
            "longitude": app.longitude,
            "land_size_sqm": app.land_size_sqm,
            "parking_type": app.parking_type,
            "opens_at": app.opens_at,
            "closes_at": app.closes_at,
            "available_days": app.available_days,
            "pricing_mode": app.pricing_mode,
            "price_per_hour": app.price_per_hour,
            "owner_name": app.owner_name,
            "owner_phone": app.owner_phone,
            "gov_id_masked": f"•••• {app.gov_id_last4}" if app.gov_id_last4 else None,
            "ownership_document_number": app.ownership_document_number,
            "owner_confirmed": app.owner_confirmed,
            "declaration_accepted": app.declaration_accepted,
            "feedback": app.feedback,
            "decided_at": app.decided_at,
            "reviewer_name": app.reviewer.full_name if app.reviewer else None,
            "applicant_phone": app.applicant.phone,
            "applicant_email": app.applicant.email,
            "applicant_verified": app.applicant.is_verified,
            "parking_location_id": parking_location_id,
            "documents": [document_out(doc) for doc in app.documents],
            "events": [
                {
                    "id": event.id,
                    "kind": event.kind,
                    "message": event.message,
                    "actor_name": event.actor.full_name if event.actor else None,
                    "created_at": event.created_at,
                }
                for event in app.events
            ],
            "missing": missing_requirements(app),
        }
    )
