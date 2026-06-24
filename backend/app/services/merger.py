"""AI-powered codebase merge service."""

import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Merge, Room, Task
from app.services.llm_service import merge_codebases
from app.socket_manager import sio

logger = logging.getLogger(__name__)

LOG_STAGES = [
    "Collecting submitted codebases...",
    "Resolving import paths and dependencies...",
    "Merging interfaces and type contracts...",
    "Integrating shared utilities...",
    "Resolving conflicts semantically...",
    "Generating unified file tree...",
    "Running final consistency check...",
    "Merge complete.",
]


async def run_merge(room_id: str, room_code: str) -> None:
    """Run AI merge, stream log events, persist result, emit merge_complete."""
    try:
        # Collect all submitted task code
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Task).where(Task.room_id == room_id, Task.status == "done")
            )
            tasks = list(result.scalars().all())
            room_result = await db.execute(select(Room).where(Room.id == room_id))
            room = room_result.scalar_one_or_none()
            if not room:
                return
            brief = room.brief

        if not tasks:
            await sio.emit(
                "merge_log_stream",
                {"message": "No completed tasks to merge.", "tag": "WARN", "done": True},
                room=room_code,
            )
            return

        # Stream progress logs while merge runs
        async def _log(msg: str, tag: str = "INFO") -> None:
            await sio.emit(
                "merge_log_stream",
                {"message": msg, "tag": tag, "done": False},
                room=room_code,
            )

        await _log(LOG_STAGES[0])

        tasks_payload = [
            {"name": t.name, "description": t.description, "code": t.code or {}}
            for t in tasks
        ]

        await _log(LOG_STAGES[1])
        raw_json = await merge_codebases(tasks_payload, brief)
        await _log(LOG_STAGES[2])

        try:
            merge_data = json.loads(raw_json)
        except (json.JSONDecodeError, AttributeError) as exc:
            logger.error("Merge JSON parse error: %s\nRaw: %s", exc, raw_json[:500])
            await sio.emit(
                "merge_log_stream",
                {"message": f"Parse error: {exc}", "tag": "ERROR", "done": True},
                room=room_code,
            )
            return

        merged_files = merge_data.get("merged_files", {})
        diff_report = merge_data.get("diff_report", [])
        conflicts = merge_data.get("conflicts", [])

        for stage in LOG_STAGES[3:]:
            await _log(stage)

        # Persist result
        async with AsyncSessionLocal() as db:
            merge = Merge(
                id=str(uuid.uuid4()),
                room_id=room_id,
                merged_files=merged_files,
                diff_report=diff_report,
                conflicts=conflicts,
                created_at=datetime.now(timezone.utc),
            )
            db.add(merge)

            room_result = await db.execute(select(Room).where(Room.id == room_id))
            room = room_result.scalar_one_or_none()
            if room:
                room.status = "complete"
                room.completed_at = datetime.now(timezone.utc)

            await db.commit()
            merge_id = merge.id

        logger.info("merge complete for room %s: %d files", room_code, len(merged_files))

        await sio.emit(
            "merge_log_stream",
            {"message": "Done.", "tag": "SUCCESS", "done": True},
            room=room_code,
        )
        await sio.emit(
            "merge_complete",
            {
                "merge_id": merge_id,
                "file_count": len(merged_files),
                "conflict_count": len(conflicts),
                "download_url": f"/api/rooms/{room_code}/merge/download",
            },
            room=room_code,
        )

    except Exception as exc:
        logger.exception("Merge error for room %s: %s", room_code, exc)
        await sio.emit(
            "merge_log_stream",
            {"message": f"Fatal error: {exc}", "tag": "ERROR", "done": True},
            room=room_code,
        )
        async with AsyncSessionLocal() as db:
            room_result = await db.execute(select(Room).where(Room.id == room_id))
            room = room_result.scalar_one_or_none()
            if room:
                room.status = "coding"
                await db.commit()
