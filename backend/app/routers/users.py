"""User profile endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_utils import get_current_user
from app.database import get_db
from app.models import Merge, Room, RoomMember, Task, User
from app.schemas import UpdateProfileRequest, UserResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user's profile."""
    return user


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UpdateProfileRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> User:
    """Update display name or avatar."""
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.avatar is not None:
        user.avatar = body.avatar
    if body.settings is not None:
        user.settings = body.settings
    await db.flush()
    return user


@router.get("/me/codebases")
async def list_codebases(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """Return all completed merge artifacts the user participated in."""
    result = await db.execute(
        select(Merge, Room)
        .join(Room, Merge.room_id == Room.id)
        .join(RoomMember, RoomMember.room_id == Room.id)
        .where(RoomMember.user_id == user.id)
        .where(Room.status == "complete")
        .order_by(Merge.created_at.desc())
    )
    rows = result.all()
    return [
        {
            "id": merge.id,
            "room_id": merge.room_id,
            "room_name": room.name,
            "room_code": room.code,
            "language": room.language,
            "merged_files": merge.merged_files,
            "created_at": merge.created_at.isoformat(),
        }
        for merge, room in rows
    ]


@router.delete("/me")
async def delete_account(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """
    Permanently delete the authenticated user's account.

    The schema has no ON DELETE cascades and a circular FK between tasks and
    room_members, so we tear down dependent rows explicitly and in order:
    rooms the user leads (with all their contents) first, then the user's
    memberships elsewhere, then the user.
    """
    # 1. Rooms led by this user — remove everything inside them.
    led_rooms = (
        await db.execute(select(Room.id).where(Room.lead_id == user.id))
    ).scalars().all()
    if led_rooms:
        # Break the task <-> member circular FK before deleting either side.
        await db.execute(
            update(Task).where(Task.room_id.in_(led_rooms)).values(assigned_to=None)
        )
        await db.execute(
            update(RoomMember).where(RoomMember.room_id.in_(led_rooms)).values(task_id=None)
        )
        await db.execute(delete(Merge).where(Merge.room_id.in_(led_rooms)))
        await db.execute(delete(Task).where(Task.room_id.in_(led_rooms)))
        await db.execute(delete(RoomMember).where(RoomMember.room_id.in_(led_rooms)))
        await db.execute(delete(Room).where(Room.id.in_(led_rooms)))

    # 2. This user's memberships in rooms led by others.
    my_member_ids = (
        await db.execute(select(RoomMember.id).where(RoomMember.user_id == user.id))
    ).scalars().all()
    if my_member_ids:
        # Unassign any tasks pointing at these member rows first (FK).
        await db.execute(
            update(Task).where(Task.assigned_to.in_(my_member_ids)).values(assigned_to=None)
        )
        await db.execute(delete(RoomMember).where(RoomMember.id.in_(my_member_ids)))

    # 3. Finally, the user.
    await db.delete(user)
    await db.commit()
    return {"detail": "Account deleted"}
