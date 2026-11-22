"""Socket.IO server: authenticated, room-based, and fed by both the API and the Celery workers.

Rooms (each event is sent to exactly one room per recipient so nobody receives it twice):
  all            every signed-in user      parking:update
  role:police   traffic officers          alert:new, alert:update, traffic:update
  role:admin    administrators            alert:new, alert:update, suggestion:new, admin:update
  user:<id>     one person                dispatch:assigned, dispatch:none, notification:new
"""

import logging
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

import socketio
from socketio.exceptions import ConnectionRefusedError

from app.core.config import settings
from app.core.redis import redis_client, revoked_session_key

log = logging.getLogger(__name__)

TICKET_TTL_SECONDS = 60
ALL_ROOM = "all"


def ticket_key(ticket: str) -> str:
    return f"realtime:ticket:{ticket}"


def user_room(user_id: uuid.UUID | str) -> str:
    return f"user:{user_id}"


def role_room(role: str) -> str:
    return f"role:{role}"


sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.cors_origins,
    client_manager=socketio.AsyncRedisManager(settings.redis_url),
    logger=False,
    engineio_logger=False,
    ping_interval=20,
    ping_timeout=25,
)

# Write-only manager: lets Celery workers and sync code publish to the same rooms through Redis.
_sync_manager = socketio.RedisManager(settings.redis_url, write_only=True)


async def issue_ticket(user_id: uuid.UUID, role: str, session_id: str) -> str:
    """A one-time, 60-second pass for opening a socket. The long-lived session token never reaches browser JS."""
    ticket = secrets.token_urlsafe(32)
    await redis_client.set(ticket_key(ticket), f"{user_id}:{role}:{session_id}", ex=TICKET_TTL_SECONDS)
    return ticket


@sio.event
async def connect(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None) -> None:
    ticket = (auth or {}).get("ticket")
    if not isinstance(ticket, str) or not ticket:
        raise ConnectionRefusedError("unauthorized")
    raw = await redis_client.getdel(ticket_key(ticket))  # single use: a leaked ticket cannot be replayed
    if not raw:
        raise ConnectionRefusedError("unauthorized")
    user_id, role, session_id = raw.split(":", 2)
    if await redis_client.exists(revoked_session_key(session_id)):
        raise ConnectionRefusedError("unauthorized")
    await sio.save_session(sid, {"user_id": user_id, "role": role, "session_id": session_id})
    await sio.enter_room(sid, ALL_ROOM)
    await sio.enter_room(sid, role_room(role))
    await sio.enter_room(sid, user_room(user_id))


@sio.event
async def disconnect(sid: str) -> None:  # rooms are cleaned up by the library
    return None


def _envelope(data: dict[str, Any]) -> dict[str, Any]:
    # `id` lets clients drop an event they already handled (e.g. replayed after a reconnect).
    return {"id": uuid.uuid4().hex, "ts": datetime.now(UTC).isoformat(), **data}


async def emit(event: str, data: dict[str, Any], room: str = ALL_ROOM) -> None:
    try:
        await sio.emit(event, _envelope(data), room=room)
    except Exception:  # noqa: BLE001 - realtime is best effort and must never fail a request
        log.exception("Could not emit %s to %s", event, room)


def emit_sync(event: str, data: dict[str, Any], room: str = ALL_ROOM) -> None:
    try:
        _sync_manager.emit(event, _envelope(data), room=room, namespace="/")
    except Exception:  # noqa: BLE001
        log.exception("Could not emit %s to %s", event, room)
