"""Task endpoints: list, assign, submit."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_utils import get_current_user, get_optional_user
from app.database import get_db
from app.models import Room, RoomMember, Task, User
from app.schemas import SubmitTaskRequest, TaskResponse
from app.socket_manager import sio

logger = logging.getLogger(__name__)
router = APIRouter()


async def _get_room_or_404(code: str, db: AsyncSession) -> Room:
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.get("/{code}/tasks", response_model=list[TaskResponse])
async def list_tasks(
    code: str,
    db: AsyncSession = Depends(get_db),
) -> list[Task]:
    """List all tasks for a room."""
    room = await _get_room_or_404(code, db)
    result = await db.execute(select(Task).where(Task.room_id == room.id))
    return list(result.scalars().all())


@router.post("/{code}/tasks/{task_id}/assign", response_model=TaskResponse)
async def assign_task(
    code: str,
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> Task:
    """Assign a task to the requesting member."""
    room = await _get_room_or_404(code, db)

    result = await db.execute(select(Task).where(Task.id == task_id, Task.room_id == room.id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "unassigned":
        raise HTTPException(status_code=409, detail="Task already assigned")

    # Find the member record for the requesting user
    member_q = select(RoomMember).where(RoomMember.room_id == room.id)
    if user:
        member_q = member_q.where(RoomMember.user_id == user.id)
    member_result = await db.execute(member_q)
    member = member_result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Not a room member")

    task.assigned_to = member.id
    task.status = "in_progress"
    member.task_id = task.id
    member.status = "coding"
    await db.commit()
    await db.refresh(task)

    # Broadcast assignment to all room members in real-time
    await sio.emit(
        "task_assigned",
        {
            "task_id": task.id,
            "assigned_to": member.id,
            "assignee_name": member.display_name,
            "status": "in_progress",
        },
        room=code.upper(),
    )

    return task


@router.post("/{code}/tasks/{task_id}/submit", response_model=TaskResponse)
async def submit_task(
    code: str,
    task_id: str,
    body: SubmitTaskRequest,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> Task:
    """Mark a task as done and store its code."""
    room = await _get_room_or_404(code, db)

    result = await db.execute(select(Task).where(Task.id == task_id, Task.room_id == room.id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.code = body.code
    task.status = "done"

    if task.assigned_to:
        member_result = await db.execute(
            select(RoomMember).where(RoomMember.id == task.assigned_to)
        )
        member = member_result.scalar_one_or_none()
        if member:
            member.status = "done"

    await db.commit()
    await db.refresh(task)
    return task


@router.get("/{code}/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    code: str,
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> Task:
    """Return a single task by ID."""
    room = await _get_room_or_404(code, db)
    result = await db.execute(select(Task).where(Task.id == task_id, Task.room_id == room.id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task
