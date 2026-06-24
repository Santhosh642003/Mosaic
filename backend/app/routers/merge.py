"""Merge endpoints: trigger, result, download ZIP."""

import io
import json
import logging
import zipfile

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_utils import get_current_user
from app.database import get_db
from app.models import Merge, Room, Task, User
from app.schemas import MergeResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/{code}/merge", response_model=MergeResponse, status_code=202)
async def trigger_merge(
    code: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MergeResponse:
    """Kick off the async merge process for a room (lead only)."""
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.lead_id != user.id:
        raise HTTPException(status_code=403, detail="Only the room lead can trigger a merge")
    if room.status not in ("coding", "waiting"):
        raise HTTPException(status_code=409, detail="Room is not in a mergeable state")

    room.status = "merging"
    await db.flush()

    # Kick off merge in background so we can return 202 immediately
    from app.services.merger import run_merge
    background_tasks.add_task(run_merge, room.id, code.upper())

    return MergeResponse(room_id=room.id, status="merging", merged_files={})


@router.get("/{code}/merge/result", response_model=MergeResponse)
async def get_merge_result(
    code: str,
    db: AsyncSession = Depends(get_db),
) -> MergeResponse:
    """Poll for the latest merge result."""
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    merge_result = await db.execute(
        select(Merge).where(Merge.room_id == room.id).order_by(Merge.created_at.desc())
    )
    merge = merge_result.scalar_one_or_none()

    if not merge:
        return MergeResponse(room_id=room.id, status=room.status, merged_files={})

    return MergeResponse(
        room_id=room.id,
        status="complete",
        merged_files=merge.merged_files or {},
        diff_report=merge.diff_report,
        conflicts=merge.conflicts,
    )


@router.get("/{code}/merge/download")
async def download_merge(
    code: str,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Download the merged codebase as a ZIP archive."""
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    merge_result = await db.execute(
        select(Merge).where(Merge.room_id == room.id).order_by(Merge.created_at.desc())
    )
    merge = merge_result.scalar_one_or_none()
    if not merge or not merge.merged_files:
        raise HTTPException(status_code=404, detail="No merge result available")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in (merge.merged_files or {}).items():
            zf.writestr(path, content if isinstance(content, str) else json.dumps(content))
    buf.seek(0)

    filename = f"mosaic-{code.upper()}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
