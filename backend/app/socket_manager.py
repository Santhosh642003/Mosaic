"""Socket.io server with Redis pub/sub for horizontal scaling."""

import json
import logging

import socketio

from app.config import settings

logger = logging.getLogger(__name__)

# Redis manager lets multiple uvicorn workers share socket state.
mgr = socketio.AsyncRedisManager(settings.redis_url)

sio = socketio.AsyncServer(
    async_mode="asgi",
    client_manager=mgr,
    cors_allowed_origins=[settings.frontend_url, "http://localhost:5173"],
    logger=False,
    engineio_logger=False,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def emit_to_room(room_code: str, event: str, data: dict) -> None:
    """Broadcast an event to every socket in a room."""
    await sio.emit(event, data, room=room_code)


async def emit_to_socket(sid: str, event: str, data: dict) -> None:
    """Send an event to a single socket."""
    await sio.emit(event, data, to=sid)


# ── Lifecycle ─────────────────────────────────────────────────────────────────

@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None) -> None:
    """Called when a client connects. Store auth token in session for later events."""
    logger.info("socket connected: %s", sid)
    if auth and isinstance(auth, dict):
        async with sio.session(sid) as session:
            session["auth_token"] = auth.get("token")


@sio.event
async def disconnect(sid: str) -> None:
    logger.info("socket disconnected: %s", sid)
    # Room cleanup is handled by the room service when it detects the member gone.


# ── Room events (imported here to register handlers) ─────────────────────────

# Import deferred to avoid circular imports; handlers registered at import time.
from app.services import socket_handlers as _  # noqa: F401, E402
