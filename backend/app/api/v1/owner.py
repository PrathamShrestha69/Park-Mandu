"""My Parking for owners: AI occupancy monitoring of the facilities they own.

An owner picks one of their approved facilities, connects its CCTV camera (the stream address), and the
same vehicle-detection model and ByteTrack tracker that drive police alerts count the vehicles parked
there (see camera-bridge/bridge.py and services/occupancy.py). Available spaces follow automatically:
capacity - occupied. The owner can correct the count by hand at any time.
"""

import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Request, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, client_ip
from app.core.errors import AppError, not_found
from app.core.realtime import emit
from app.core.redis import redis_client
from app.models.enums import CameraStatus
from app.models.monitoring import Camera
from app.models.parking import ParkingLocation
from app.models.user import User
from app.schemas.common import MessageOut
from app.schemas.monitoring import TrackedVehicle
from app.schemas.parking import OccupancyCorrection, OwnerCameraConnect, OwnerCameraOut, OwnerParkingOut
from app.services import audit, occupancy
from app.services import parking as parking_service
from app.services.traffic import decode_tracking, tracking_key
from app.worker.tasks import DETECTOR_TIMEOUT

router = APIRouter(prefix="/my-parkings", tags=["owner"])

CONNECTION_LABELS = {
    "connected": "Connected · counting vehicles",
    "waiting": "Waiting for the AI detector to connect",
    "disconnected": "Disconnected · showing the last count",
    "maintenance": "Under maintenance",
}


def connection_state(camera: Camera, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    if camera.status == CameraStatus.MAINTENANCE:
        return "maintenance"
    if camera.detector_seen_at is None:
        return "waiting"
    fresh = camera.last_heartbeat_at is not None and now - camera.last_heartbeat_at < DETECTOR_TIMEOUT
    return "connected" if camera.status == CameraStatus.LIVE and fresh else "disconnected"


async def _camera_out(camera: Camera) -> OwnerCameraOut:
    state = connection_state(camera)
    detected = None
    if state == "connected":
        data = decode_tracking(await redis_client.get(tracking_key(camera.id)))
        if data is not None:
            tracks = [TrackedVehicle.model_validate(t) for t in data.get("tracks", [])]
            detected = occupancy.vehicle_count(tracks)
    return OwnerCameraOut(
        id=camera.id,
        code=camera.code,
        name=camera.name,
        source_url=camera.source_url,
        connection=state,  # type: ignore[arg-type]
        connection_label=CONNECTION_LABELS[state],
        last_seen_at=camera.last_heartbeat_at if camera.detector_seen_at else None,
        stream_url=camera.stream_url if state == "connected" else None,
        detected_vehicles=detected,
    )


async def _owner_camera(db: DbSession, parking: ParkingLocation) -> Camera | None:
    return await db.scalar(
        select(Camera)
        .where(Camera.parking_id == parking.id, Camera.owner_id == parking.owner_id)
        .order_by(Camera.created_at.desc())
        .limit(1)
    )


async def _out(db: DbSession, parking: ParkingLocation) -> OwnerParkingOut:
    camera = await _owner_camera(db, parking)
    return OwnerParkingOut.model_validate(
        {
            **parking_service.to_detail(parking).model_dump(),
            "camera": await _camera_out(camera) if camera else None,
            "manual_hold": await occupancy.is_on_manual_hold(parking.id),
        }
    )


async def _load(db: DbSession, parking_id: uuid.UUID, user: User, *, lock: bool = False) -> ParkingLocation:
    stmt = select(ParkingLocation).where(ParkingLocation.id == parking_id, ParkingLocation.owner_id == user.id)
    parking = await db.scalar(stmt.with_for_update() if lock else stmt)
    if parking is None:
        raise not_found("Parking location")
    return parking


async def _new_camera_code(db: DbSession) -> str:
    while True:
        code = f"PK-{secrets.token_hex(3).upper()}"
        if await db.scalar(select(Camera.id).where(Camera.code == code)) is None:
            return code


@router.get("", response_model=list[OwnerParkingOut], summary="Facilities I own, with occupancy and camera status")
async def my_parkings(user: CurrentUser, db: DbSession) -> list[OwnerParkingOut]:
    rows = await db.scalars(
        select(ParkingLocation).where(ParkingLocation.owner_id == user.id).order_by(ParkingLocation.name)
    )
    return [await _out(db, p) for p in rows]


@router.get("/{parking_id}", response_model=OwnerParkingOut)
async def my_parking(parking_id: uuid.UUID, user: CurrentUser, db: DbSession) -> OwnerParkingOut:
    return await _out(db, await _load(db, parking_id, user))


@router.put(
    "/{parking_id}/camera",
    response_model=OwnerParkingOut,
    summary="Connect (or update) the CCTV camera that counts vehicles in this facility",
)
async def connect_camera(
    request: Request, parking_id: uuid.UUID, body: OwnerCameraConnect, user: CurrentUser, db: DbSession
) -> OwnerParkingOut:
    parking = await _load(db, parking_id, user)
    camera = await _owner_camera(db, parking)
    if camera is None:
        camera = Camera(
            code=await _new_camera_code(db),
            name=body.name.strip(),
            road=parking.address[:160],
            area=parking.area,
            zone="Parking",
            latitude=parking.latitude,
            longitude=parking.longitude,
            # Offline until the AI detector reports for it; never stood in for by the demo simulator.
            status=CameraStatus.OFFLINE,
            parking_id=parking.id,
            owner_id=user.id,
            source_url=body.source_url,
        )
        db.add(camera)
    else:
        if camera.source_url != body.source_url:
            # A different stream is a different picture: wait for the detector to reconnect to it.
            camera.detector_seen_at = None
            camera.stream_url = None
            camera.status = CameraStatus.OFFLINE
        camera.name = body.name.strip()
        camera.source_url = body.source_url
    await db.flush()
    audit.record(
        db,
        actor=user,
        action="parking.camera_connected",
        entity_type="parking",
        entity_id=parking.id,
        ip_address=client_ip(request),
        camera_code=camera.code,
    )
    await db.commit()
    return await _out(db, parking)


@router.delete("/{parking_id}/camera", response_model=MessageOut, summary="Disconnect this facility's camera")
async def disconnect_camera(request: Request, parking_id: uuid.UUID, user: CurrentUser, db: DbSession) -> MessageOut:
    parking = await _load(db, parking_id, user)
    camera = await _owner_camera(db, parking)
    if camera is None:
        raise not_found("Camera")
    audit.record(
        db,
        actor=user,
        action="parking.camera_disconnected",
        entity_type="parking",
        entity_id=parking.id,
        ip_address=client_ip(request),
        camera_code=camera.code,
    )
    await db.delete(camera)
    await db.commit()
    await redis_client.delete(tracking_key(camera.id))
    await occupancy.clear_hold(parking.id)
    return MessageOut(message="Camera disconnected. Update the occupancy by hand until you connect another one.")


@router.put("/{parking_id}/occupancy", response_model=OwnerParkingOut, summary="Correct how many spaces are taken")
async def correct_occupancy(
    request: Request, parking_id: uuid.UUID, body: OccupancyCorrection, user: CurrentUser, db: DbSession
) -> OwnerParkingOut:
    parking = await _load(db, parking_id, user, lock=True)
    if body.occupied_spaces > parking.capacity:
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Please check the highlighted fields.",
            {"occupied_spaces": f"This facility only has {parking.capacity} spaces."},
        )
    parking_service.set_occupancy(parking, body.occupied_spaces)
    audit.record(
        db,
        actor=user,
        action="parking.occupancy",
        entity_type="parking",
        entity_id=parking.id,
        ip_address=client_ip(request),
        occupied=body.occupied_spaces,
    )
    payload = parking_service.realtime_payload(parking)
    await db.commit()
    await occupancy.hold_after_manual_correction(parking.id)
    await redis_client.delete("cache:admin:dashboard")
    await emit("parking:update", payload)
    return await _out(db, parking)
