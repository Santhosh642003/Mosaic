"""Room CRUD endpoints: create, join, get state, list."""

import json
import logging
import random
import string

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_utils import get_current_user, get_optional_user
from app.config import settings
from app.database import get_db, get_redis
from app.models import Room, RoomMember, User
from app.schemas import (
    CreateRoomRequest,
    JoinRoomRequest,
    MemberResponse,
    RoomResponse,
    RoomStateResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()

ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _generate_code(length: int = 6) -> str:
    return "".join(random.choices(ROOM_CODE_CHARS, k=length))


async def _unique_code(db: AsyncSession) -> str:
    """Generate a 6-char room code guaranteed to be unique."""
    for _ in range(10):
        code = _generate_code(settings.room_code_length)
        exists = await db.execute(select(Room).where(Room.code == code))
        if not exists.scalar_one_or_none():
            return code
    raise RuntimeError("Could not generate unique room code after 10 tries")


ROOM_STATE_KEY = "room:{code}:state"
ROOM_TTL = settings.room_ttl_hours * 3600


# ── Create room ───────────────────────────────────────────────────────────────

@router.post("", response_model=RoomResponse, status_code=201)
async def create_room(
    body: CreateRoomRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    user: User = Depends(get_current_user),
) -> Room:
    """Create a new room; returns the room with its generated code."""
    code = await _unique_code(db)

    room = Room(
        code=code,
        name=body.name,
        brief=body.brief,
        language=body.language,
        max_teammates=min(body.max_teammates, settings.max_teammates),
        lead_id=user.id,
        status="waiting",
    )
    db.add(room)
    await db.flush()

    # Add lead as first member
    member = RoomMember(
        room_id=room.id,
        user_id=user.id,
        display_name=user.display_name,
        role="lead",
        status="waiting",
        is_guest=False,
    )
    db.add(member)
    await db.flush()

    # Seed live room state in Redis
    state = {
        "room_id": room.id,
        "code": code,
        "status": "waiting",
        "members": {
            member.id: {
                "id": member.id,
                "display_name": user.display_name,
                "role": "lead",
                "status": "waiting",
                "is_guest": False,
            }
        },
    }
    await redis.setex(ROOM_STATE_KEY.format(code=code), ROOM_TTL, json.dumps(state))

    logger.info("room created: %s (%s) by %s", code, room.id, user.id)
    return room


# ── Join room ─────────────────────────────────────────────────────────────────

@router.post("/{code}/join", response_model=MemberResponse, status_code=201)
async def join_room(
    code: str,
    body: JoinRoomRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    user: User | None = Depends(get_optional_user),
) -> RoomMember:
    """Join an existing room (authenticated or guest)."""
    code = code.upper()
    result = await db.execute(select(Room).where(Room.code == code))
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.status in ("complete", "merging"):
        raise HTTPException(status_code=410, detail="Room is closed")

    member_count = len(room.members)
    if member_count >= room.max_teammates:
        raise HTTPException(status_code=409, detail="Room is full")

    # Guest path
    is_guest = user is None
    display_name = (user.display_name if user else body.display_name) or "Guest"
    user_id = user.id if user else None

    # Prevent duplicate joins
    if user_id:
        for m in room.members:
            if m.user_id == user_id:
                return m

    member = RoomMember(
        room_id=room.id,
        user_id=user_id,
        display_name=display_name,
        role="member",
        status="waiting",
        is_guest=is_guest,
    )
    db.add(member)
    await db.flush()

    # Update Redis state
    raw = await redis.get(ROOM_STATE_KEY.format(code=code))
    if raw:
        state = json.loads(raw)
        state["members"][member.id] = {
            "id": member.id,
            "display_name": display_name,
            "role": "member",
            "status": "waiting",
            "is_guest": is_guest,
        }
        await redis.setex(ROOM_STATE_KEY.format(code=code), ROOM_TTL, json.dumps(state))

    return member


# ── Get room state ─────────────────────────────────────────────────────────────

@router.get("/{code}/state", response_model=RoomStateResponse)
async def get_room_state(
    code: str,
    db: AsyncSession = Depends(get_db),
) -> RoomStateResponse:
    """Return current room state (members + tasks) from PostgreSQL."""
    code = code.upper()
    result = await db.execute(select(Room).where(Room.code == code))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    from app.schemas import TaskResponse
    return RoomStateResponse(
        room=RoomResponse.model_validate(room),
        members=[MemberResponse.model_validate(m) for m in room.members],
        tasks=[TaskResponse.model_validate(t) for t in room.tasks],
    )


# ── List user's rooms ─────────────────────────────────────────────────────────

@router.get("", response_model=list[RoomResponse])
async def list_rooms(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Room]:
    """Return all rooms where the authenticated user is a member."""
    result = await db.execute(
        select(Room)
        .join(RoomMember, RoomMember.room_id == Room.id)
        .where(RoomMember.user_id == user.id)
        .order_by(Room.created_at.desc())
    )
    return list(result.scalars().all())


# ── Get single room ───────────────────────────────────────────────────────────

@router.get("/{code}", response_model=RoomResponse)
async def get_room(code: str, db: AsyncSession = Depends(get_db)) -> Room:
    """Return a single room by code."""
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room
