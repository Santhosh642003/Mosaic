"""Socket.io event handlers for real-time room collaboration."""

import json
import logging

from sqlalchemy import select

from app.auth_utils import decode_token
from app.database import AsyncSessionLocal, get_redis_direct
from app.models import Room, RoomMember, Task, User
from app.socket_manager import sio

logger = logging.getLogger(__name__)

ROOM_STATE_KEY = "room:{code}:state"
ROOM_TTL = 48 * 3600


async def _get_member_and_room(sid: str) -> tuple[str, str] | tuple[None, None]:
    """Look up (room_code, member_id) from socket session storage."""
    async with sio.session(sid) as session:
        return session.get("room_code"), session.get("member_id")


# ── join_room ─────────────────────────────────────────────────────────────────

@sio.on("join_room")
async def handle_join_room(sid: str, data: dict) -> None:
    """
    Client sends: { code, token?, member_id? }
    Validate token, join the socket.io room, emit room_state back.
    """
    code = (data.get("code") or "").upper()
    member_id = data.get("member_id")

    # Token can come from the event payload or the connect-time auth
    token = data.get("token")
    if not token:
        async with sio.session(sid) as session:
            token = session.get("auth_token")

    if not code:
        await sio.emit("error", {"message": "Room code required"}, to=sid)
        return

    # Validate JWT if provided
    user_id = None
    if token:
        try:
            user_id = decode_token(token)
        except Exception:
            pass  # invalid token — treat as guest

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Room).where(Room.code == code))
        room = result.scalar_one_or_none()
        if not room:
            await sio.emit("error", {"message": "Room not found"}, to=sid)
            return

        # Resolve member_id from user_id when not supplied
        if not member_id and user_id:
            m_result = await db.execute(
                select(RoomMember).where(
                    RoomMember.room_id == room.id,
                    RoomMember.user_id == user_id,
                )
            )
            m = m_result.scalar_one_or_none()
            if m:
                member_id = m.id

        # Store lookup in socket session
        async with sio.session(sid) as session:
            session["room_code"] = code
            session["member_id"] = member_id
            session["user_id"] = user_id

    await sio.enter_room(sid, code)
    logger.info("socket %s joined room %s (member=%s)", sid, code, member_id)

    # Push current room state from Redis or DB
    redis = await get_redis_direct()
    raw = await redis.get(ROOM_STATE_KEY.format(code=code))
    if raw:
        state = json.loads(raw)
    else:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Room).where(Room.code == code))
            room = result.scalar_one_or_none()
            if room:
                state = {
                    "room_id": room.id,
                    "code": code,
                    "status": room.status,
                    "members": {
                        m.id: {
                            "id": m.id,
                            "display_name": m.display_name,
                            "role": m.role,
                            "status": m.status,
                            "is_guest": m.is_guest,
                        }
                        for m in room.members
                    },
                }
            else:
                state = {}

    await sio.emit("room_state", state, to=sid)


# ── update_status ──────────────────────────────────────────────────────────────

@sio.on("update_status")
async def handle_update_status(sid: str, data: dict) -> None:
    """
    Client sends: { status: 'coding' | 'blocked' | 'done' | 'waiting' }
    Updates Redis + broadcasts teammate_status_update to room.
    """
    new_status = data.get("status")
    if new_status not in ("coding", "blocked", "done", "waiting"):
        return

    room_code, member_id = await _get_member_and_room(sid)
    if not room_code or not member_id:
        return

    # Update DB
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(RoomMember).where(RoomMember.id == member_id))
        member = result.scalar_one_or_none()
        if member:
            member.status = new_status
            await db.commit()

    # Update Redis
    redis = await get_redis_direct()
    raw = await redis.get(ROOM_STATE_KEY.format(code=room_code))
    if raw:
        state = json.loads(raw)
        if member_id in state.get("members", {}):
            state["members"][member_id]["status"] = new_status
            await redis.setex(ROOM_STATE_KEY.format(code=room_code), ROOM_TTL, json.dumps(state))

    # Broadcast
    await sio.emit(
        "teammate_status_update",
        {"member_id": member_id, "status": new_status},
        room=room_code,
    )


# ── submit_task ────────────────────────────────────────────────────────────────

@sio.on("submit_task")
async def handle_submit_task(sid: str, data: dict) -> None:
    """
    Client sends: { task_id, code: { filename: content } }
    Stores code, marks task done, broadcasts task_submitted.
    """
    task_id = data.get("task_id")
    code_payload = data.get("code", {})

    room_code, member_id = await _get_member_and_room(sid)
    if not room_code or not member_id:
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Task).where(Task.id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return

        task.code = code_payload
        task.status = "done"

        member_result = await db.execute(select(RoomMember).where(RoomMember.id == member_id))
        member = member_result.scalar_one_or_none()
        if member:
            member.status = "done"

        await db.commit()

    await sio.emit(
        "task_submitted",
        {"task_id": task_id, "member_id": member_id},
        room=room_code,
    )
    logger.info("task %s submitted by member %s in room %s", task_id, member_id, room_code)


# ── trigger_decomposition ──────────────────────────────────────────────────────

@sio.on("trigger_decomposition")
async def handle_trigger_decomposition(sid: str, data: dict) -> None:
    """
    Lead triggers decomposition of the room brief into tasks.
    Streams decomposition_stream events then decomposition_complete.
    """
    room_code, member_id = await _get_member_and_room(sid)
    if not room_code:
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Room).where(Room.code == room_code))
        room = result.scalar_one_or_none()
        if not room:
            return

        # Verify requester is lead
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
        if room.lead_id != user_id:
            await sio.emit("error", {"message": "Only the lead can start decomposition"}, to=sid)
            return

        room.status = "decomposing"
        await db.commit()
        brief = room.brief
        language = room.language or []
        max_teammates = room.max_teammates
        room_id = room.id

    logger.info("decomposition triggered for room %s", room_code)

    from app.services.decomposer import run_decomposition
    import asyncio
    asyncio.create_task(run_decomposition(room_id, room_code, brief, language, max_teammates))


# ── trigger_merge ──────────────────────────────────────────────────────────────

@sio.on("trigger_merge")
async def handle_trigger_merge(sid: str, data: dict) -> None:
    """Lead triggers the AI merge. Streams merge_log_stream events."""
    room_code, member_id = await _get_member_and_room(sid)
    if not room_code:
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Room).where(Room.code == room_code))
        room = result.scalar_one_or_none()
        if not room:
            return

        async with sio.session(sid) as session:
            user_id = session.get("user_id")
        if room.lead_id != user_id:
            await sio.emit("error", {"message": "Only the lead can trigger merge"}, to=sid)
            return

        room.status = "merging"
        await db.commit()
        room_id = room.id

    logger.info("merge triggered for room %s", room_code)

    from app.services.merger import run_merge
    import asyncio
    asyncio.create_task(run_merge(room_id, room_code))


# ── ai_prompt ─────────────────────────────────────────────────────────────────

@sio.on("ai_prompt")
async def handle_ai_prompt(sid: str, data: dict) -> None:
    """
    Client sends: { prompt, context_code?, task_id? }
    Streams ai_response_stream chunks back to the requesting socket only.
    """
    prompt = data.get("prompt", "").strip()
    context_code = data.get("context_code", "")
    task_id = data.get("task_id")

    if not prompt:
        return

    room_code, member_id = await _get_member_and_room(sid)

    # Fetch task context for richer prompts
    task_context = ""
    if task_id:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Task).where(Task.id == task_id))
            task = result.scalar_one_or_none()
            if task:
                task_context = (
                    f"Task: {task.name}\n"
                    f"Description: {task.description}\n"
                    f"Tech: {task.tech}\n"
                    f"Files to create: {', '.join(task.files or [])}\n"
                )

    from app.services.llm_service import stream_coding_response
    try:
        async for chunk in stream_coding_response(prompt, context_code, task_context):
            await sio.emit("ai_response_stream", {"chunk": chunk, "done": False}, to=sid)
        await sio.emit("ai_response_stream", {"chunk": "", "done": True}, to=sid)
    except Exception as exc:
        logger.exception("ai_prompt error: %s", exc)
        await sio.emit("ai_response_stream", {"chunk": "", "done": True, "error": str(exc)}, to=sid)
