import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, Request, UploadFile, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, PublicUser, client_ip
from app.core.errors import AppError, conflict, forbidden, not_found
from app.core.rate_limit import limiter
from app.core.security import encrypt_field
from app.models.application import ApplicationDocument, ApplicationEvent, ParkingApplication
from app.models.enums import (
    EDITABLE_APPLICATION_STATUSES,
    PENDING_APPLICATION_STATUSES,
    ApplicationEventKind,
    ApplicationStatus,
    DocumentKind,
    NotificationKind,
    NotificationTone,
    UserRole,
)
from app.models.parking import ParkingLocation
from app.models.user import User
from app.schemas.application import (
    ApplicationDetail,
    ApplicationFilters,
    ApplicationSummary,
    DocumentOut,
    LocationStep,
    OwnerStep,
    PropertyStep,
    StatusCounts,
    SubmitRequest,
)
from app.schemas.common import MessageOut
from app.services import applications as app_service
from app.services import audit, storage
from app.utils.pagination import Page, paginate
from app.utils.text import escape_like
from app.worker.tasks import notify, process_document

router = APIRouter(prefix="/applications", tags=["applications"])

MAX_OPEN_DRAFTS = 5
MAX_FILES_PER_KIND = {
    DocumentKind.OWNERSHIP_DOCUMENT: 3,
    DocumentKind.GOVERNMENT_ID: 2,
    DocumentKind.PROPERTY_PHOTO: 6,
    DocumentKind.PARKING_PHOTO: 6,
}
PHOTO_KINDS = {DocumentKind.PROPERTY_PHOTO, DocumentKind.PARKING_PHOTO}


async def load_application(db: DbSession, application_id: uuid.UUID, user: User) -> ParkingApplication:
    app = await db.scalar(
        app_service.detail_query()
        .where(ParkingApplication.id == application_id)
        .execution_options(populate_existing=True)
    )
    if app is None:
        raise not_found("Application")
    if user.role != UserRole.ADMIN and app.applicant_id != user.id:
        raise not_found("Application")
    return app


async def detail_response(db: DbSession, app: ParkingApplication) -> ApplicationDetail:
    parking_id = await db.scalar(select(ParkingLocation.id).where(ParkingLocation.application_id == app.id))
    return app_service.to_detail(app, parking_id)


def ensure_editable(app: ParkingApplication) -> None:
    if app.status not in EDITABLE_APPLICATION_STATUSES:
        raise conflict("This application is with the review team and can no longer be edited.", "application_locked")


@router.get("/mine", response_model=Page[ApplicationSummary])
async def my_applications(
    filters: Annotated[ApplicationFilters, Query()], user: CurrentUser, db: DbSession
) -> dict[str, Any]:
    stmt = app_service.with_relations(select(ParkingApplication)).where(ParkingApplication.applicant_id == user.id)
    if filters.status == "pending":
        stmt = stmt.where(ParkingApplication.status.in_(PENDING_APPLICATION_STATUSES))
    elif filters.status:
        stmt = stmt.where(ParkingApplication.status == filters.status)
    if filters.q:
        pattern = f"%{escape_like(filters.q.strip())}%"
        stmt = stmt.where(
            ParkingApplication.property_name.ilike(pattern, escape="\\")
            | ParkingApplication.reference.ilike(pattern, escape="\\")
            | ParkingApplication.address.ilike(pattern, escape="\\")
        )
    order = ParkingApplication.updated_at.asc() if filters.sort == "oldest" else ParkingApplication.updated_at.desc()
    stmt = stmt.order_by(order, ParkingApplication.id)
    return await paginate(db, stmt, filters, transform=app_service.to_summary)


@router.get("/mine/counts", response_model=StatusCounts)
async def my_counts(user: CurrentUser, db: DbSession) -> StatusCounts:
    rows = (
        await db.execute(
            select(ParkingApplication.status, func.count())
            .where(ParkingApplication.applicant_id == user.id)
            .group_by(ParkingApplication.status)
        )
    ).all()
    counts = {row[0]: row[1] for row in rows}
    return StatusCounts(
        total=sum(counts.values()),
        draft=counts.get(ApplicationStatus.DRAFT, 0),
        pending=sum(counts.get(s, 0) for s in PENDING_APPLICATION_STATUSES),
        approved=counts.get(ApplicationStatus.APPROVED, 0),
        rejected=counts.get(ApplicationStatus.REJECTED, 0),
        changes_requested=counts.get(ApplicationStatus.CHANGES_REQUESTED, 0),
    )


@router.post("", response_model=ApplicationDetail, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def create_draft(request: Request, user: PublicUser, db: DbSession) -> ApplicationDetail:
    drafts = await db.scalar(
        select(func.count()).where(
            ParkingApplication.applicant_id == user.id, ParkingApplication.status == ApplicationStatus.DRAFT
        )
    )
    if (drafts or 0) >= MAX_OPEN_DRAFTS:
        raise conflict(
            f"You already have {MAX_OPEN_DRAFTS} unfinished drafts. Complete or delete one first.", "too_many_drafts"
        )
    app = ParkingApplication(
        applicant_id=user.id, owner_name=user.full_name, owner_phone=user.phone, status=ApplicationStatus.DRAFT
    )
    db.add(app)
    await db.commit()
    return await detail_response(db, await load_application(db, app.id, user))


@router.get("/{application_id}", response_model=ApplicationDetail)
async def get_application(application_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ApplicationDetail:
    return await detail_response(db, await load_application(db, application_id, user))


@router.put("/{application_id}/location", response_model=ApplicationDetail, summary="Step 1 — location")
async def save_location(
    application_id: uuid.UUID, body: LocationStep, user: CurrentUser, db: DbSession
) -> ApplicationDetail:
    app = await load_application(db, application_id, user)
    ensure_editable(app)
    app.latitude, app.longitude = body.latitude, body.longitude
    app.address = body.address.strip()
    app.area = (body.area or "").strip() or None
    app.completed_step = max(app.completed_step, 1)
    await db.commit()
    return await detail_response(db, await load_application(db, application_id, user))


@router.put("/{application_id}/property", response_model=ApplicationDetail, summary="Step 2 — property details")
async def save_property(
    application_id: uuid.UUID, body: PropertyStep, user: CurrentUser, db: DbSession
) -> ApplicationDetail:
    app = await load_application(db, application_id, user)
    ensure_editable(app)
    for field, value in body.model_dump().items():
        setattr(app, field, value.strip() if isinstance(value, str) else value)
    app.completed_step = max(app.completed_step, 2)
    await db.commit()
    return await detail_response(db, await load_application(db, application_id, user))


@router.put("/{application_id}/owner", response_model=ApplicationDetail, summary="Step 3 — owner information")
async def save_owner(application_id: uuid.UUID, body: OwnerStep, user: CurrentUser, db: DbSession) -> ApplicationDetail:
    app = await load_application(db, application_id, user)
    ensure_editable(app)
    app.owner_name = body.owner_name.strip()
    app.owner_phone = body.owner_phone
    app.gov_id_encrypted = encrypt_field(body.government_id)
    app.gov_id_last4 = body.government_id.replace("-", "").replace("/", "").replace(" ", "")[-4:]
    app.ownership_document_number = body.ownership_document_number.strip()
    app.owner_confirmed = True
    app.completed_step = max(app.completed_step, 3)
    await db.commit()
    return await detail_response(db, await load_application(db, application_id, user))


@router.post(
    "/{application_id}/documents",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Step 4 — upload a supporting document",
)
@limiter.limit("30/minute")
async def upload_document(
    request: Request,
    application_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File(description="JPG, PNG, WEBP or PDF up to 10 MB")],
) -> dict[str, Any]:
    app = await load_application(db, application_id, user)
    ensure_editable(app)
    existing = sum(1 for doc in app.documents if doc.kind == kind)
    if existing >= MAX_FILES_PER_KIND[kind]:
        raise conflict(f"You can upload up to {MAX_FILES_PER_KIND[kind]} files for this document.", "too_many_files")

    saved = await storage.save_upload(file, f"applications/{app.id}", photos_only=kind in PHOTO_KINDS)
    doc = ApplicationDocument(application_id=app.id, kind=kind, **saved)
    db.add(doc)
    await db.commit()
    process_document.delay(str(doc.id))
    return app_service.document_out(doc)


@router.delete("/{application_id}/documents/{document_id}", response_model=MessageOut)
async def delete_document(
    application_id: uuid.UUID, document_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> MessageOut:
    app = await load_application(db, application_id, user)
    ensure_editable(app)
    doc = next((d for d in app.documents if d.id == document_id), None)
    if doc is None:
        raise not_found("Document")
    keys = (doc.storage_key, doc.thumbnail_key)
    await db.delete(doc)
    await db.commit()
    storage.delete(*keys)
    return MessageOut(message="Document removed.")


@router.post("/{application_id}/submit", response_model=ApplicationDetail, summary="Step 5 — submit for approval")
@limiter.limit("10/minute")
async def submit_application(
    request: Request, application_id: uuid.UUID, body: SubmitRequest, user: CurrentUser, db: DbSession
) -> ApplicationDetail:
    app = await load_application(db, application_id, user)
    if app.applicant_id != user.id:
        raise forbidden("Only the applicant can submit this application.")
    ensure_editable(app)
    missing = app_service.missing_requirements(app)
    if missing:
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "application_incomplete",
            "Some required information is missing.",
            {item: "Required before submission" for item in missing},
        )

    resubmission = app.status == ApplicationStatus.CHANGES_REQUESTED
    now = datetime.now(UTC)
    if app.reference is None:
        app.reference = f"PM-{now.year}-{app.seq:06d}"
    app.status = ApplicationStatus.SUBMITTED
    app.declaration_accepted = body.declaration_accepted
    app.submitted_at = now
    app.completed_step = 5
    db.add(
        ApplicationEvent(
            application_id=app.id,
            kind=ApplicationEventKind.RESUBMITTED if resubmission else ApplicationEventKind.SUBMITTED,
            message="Updated application resubmitted for review." if resubmission else "Application received.",
            actor_id=user.id,
        )
    )
    audit.record(
        db,
        actor=user,
        action="application.submitted",
        entity_type="application",
        entity_id=app.id,
        ip_address=client_ip(request),
        reference=app.reference,
    )
    await db.commit()
    notify(
        user.id,
        NotificationKind.APPLICATION_RECEIVED,
        NotificationTone.INFO,
        "Your parking application has been received.",
        f"{app.property_name} ({app.reference}) is now waiting for government review.",
        "application",
        app.id,
    )
    return await detail_response(db, await load_application(db, application_id, user))


@router.delete("/{application_id}", response_model=MessageOut)
async def delete_draft(application_id: uuid.UUID, user: CurrentUser, db: DbSession) -> MessageOut:
    app = await load_application(db, application_id, user)
    if app.status != ApplicationStatus.DRAFT or app.applicant_id != user.id:
        raise conflict("Only your own unsubmitted drafts can be deleted.", "not_a_draft")
    keys = [key for doc in app.documents for key in (doc.storage_key, doc.thumbnail_key)]
    await db.delete(app)
    await db.commit()
    storage.delete(*keys)
    return MessageOut(message="Draft deleted.")
