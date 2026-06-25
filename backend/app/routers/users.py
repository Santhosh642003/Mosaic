"""User profile endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
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
    """Permanently delete the authenticated user's account."""
    await db.delete(user)
    await db.commit()
    return {"detail": "Account deleted"}
