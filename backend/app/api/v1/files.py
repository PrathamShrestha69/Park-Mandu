import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, PoliceUser
from app.core.errors import not_found
from app.models.application import ApplicationDocument, ParkingApplication
from app.models.enums import UserRole
from app.models.monitoring import Alert
from app.services import storage

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/documents/{document_id}", summary="Download an application document (applicant or admin only)")
async def download_document(
    document_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    variant: Annotated[Literal["original", "thumbnail"], Query()] = "original",
) -> FileResponse:
    row = (
        await db.execute(
            select(ApplicationDocument, ParkingApplication.applicant_id)
            .join(ParkingApplication, ParkingApplication.id == ApplicationDocument.application_id)
            .where(ApplicationDocument.id == document_id)
        )
    ).first()
    if row is None:
        raise not_found("Document")
    doc, applicant_id = row
    if user.role != UserRole.ADMIN and applicant_id != user.id:
        raise not_found("Document")

    key = doc.thumbnail_key if variant == "thumbnail" and doc.thumbnail_key else doc.storage_key
    path = storage.resolve(key)
    if not path.exists():
        raise not_found("File")
    media_type = "image/webp" if key.endswith("_thumb.webp") else doc.content_type
    return FileResponse(
        path,
        media_type=media_type,
        filename=doc.original_name if variant == "original" else None,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/alerts/{alert_id}/snapshot", summary="Vehicle image captured by the AI detector (police and admin)")
async def alert_snapshot(alert_id: uuid.UUID, _: PoliceUser, db: DbSession) -> FileResponse:
    key = await db.scalar(select(Alert.snapshot_key).where(Alert.id == alert_id))
    if not key:
        raise not_found("Snapshot")
    path = storage.resolve(key)
    if not path.exists():
        raise not_found("Snapshot")
    return FileResponse(
        path,
        media_type=storage.content_type_for(key),
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
