import hashlib
import os
import uuid
from pathlib import Path

import filetype
from fastapi import UploadFile, status

from app.core.config import settings
from app.core.errors import AppError

ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}
PHOTO_ONLY = {"image/jpeg", "image/png", "image/webp"}
CHUNK = 1024 * 1024


def root() -> Path:
    path = Path(settings.upload_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve(key: str) -> Path:
    """Maps a storage key to a path, refusing anything that escapes the upload root."""
    base = root().resolve()
    path = (base / key).resolve()
    if base not in path.parents:
        raise AppError(status.HTTP_400_BAD_REQUEST, "invalid_key", "Invalid file reference.")
    return path


async def save_upload(file: UploadFile, folder: str, *, photos_only: bool = False) -> dict[str, object]:
    """Streams an upload to disk, enforcing size and sniffing the real content type from its bytes."""
    head = await file.read(2048)
    kind = filetype.guess(head)
    content_type = kind.mime if kind else None
    allowed = PHOTO_ONLY if photos_only else set(ALLOWED_TYPES)
    if content_type not in allowed:
        accepted = "JPG, PNG or WEBP" if photos_only else "JPG, PNG, WEBP or PDF"
        raise AppError(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "unsupported_file",
            f"This file type is not supported. Upload {accepted}.",
            {"file": f"Upload {accepted}."},
        )

    key = f"{folder}/{uuid.uuid4().hex}.{ALLOWED_TYPES[content_type]}"
    path = resolve(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("wb") as out:
            chunk = head
            while chunk:
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise AppError(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        "file_too_large",
                        f"Files must be {settings.max_upload_mb} MB or smaller.",
                        {"file": f"Maximum {settings.max_upload_mb} MB."},
                    )
                digest.update(chunk)
                out.write(chunk)
                chunk = await file.read(CHUNK)
    except AppError:
        path.unlink(missing_ok=True)
        raise

    return {
        "storage_key": key,
        "content_type": content_type,
        "size_bytes": size,
        "checksum_sha256": digest.hexdigest(),
        "original_name": os.path.basename(file.filename or "upload")[:255],
    }


def delete(*keys: str | None) -> None:
    for key in keys:
        if key:
            resolve(key).unlink(missing_ok=True)
