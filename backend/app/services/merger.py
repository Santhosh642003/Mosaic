"""AI-powered codebase merge service."""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Merge, Room, Task
from app.services.ast_validator import validate_files
from app.services.llm_service import merge_codebases, merge_self_correct
from app.socket_manager import sio

logger = logging.getLogger(__name__)

LOG_STAGES = [
    "Collecting submitted codebases...",
    "Resolving import paths and dependencies...",
    "Merging interfaces and type contracts...",
    "Integrating shared utilities...",
    "Resolving conflicts semantically...",
    "Generating unified file tree...",
    "Running syntax/AST validation...",
    "Merge complete.",
]


async def run_merge(room_id: str, room_code: str) -> None:
    """Run AI merge, stream log events, persist result, emit merge_complete."""
    try:
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

        # Guard 1: structured, validated merge result
        try:
            merge_result = await merge_codebases(tasks_payload, brief)
        except ValueError as exc:
            logger.error("Merge structured output failed: %s", exc)
            await sio.emit(
                "merge_log_stream",
                {"message": f"Merge failed: {exc}", "tag": "ERROR", "done": True},
                room=room_code,
            )
            await sio.emit(
                "merge_error",
                {"message": f"AI merge failed: {exc}. Please try again."},
                room=room_code,
            )
            async with AsyncSessionLocal() as db:
                room_result = await db.execute(select(Room).where(Room.id == room_id))
                room = room_result.scalar_one_or_none()
                if room:
                    room.status = "coding"
                    await db.commit()
            return

        await _log(LOG_STAGES[2])
        await _log(LOG_STAGES[3])
        await _log(LOG_STAGES[4])
        await _log(LOG_STAGES[5])

        merged_files = merge_result.merged_files
        diff_report = [e.model_dump() for e in merge_result.diff_report]
        conflicts = [e.model_dump() for e in merge_result.conflicts]

        # Guard 3 MVP: AST/syntax validation + one self-correction pass
        await _log(LOG_STAGES[6])
        parse_errors = validate_files(merged_files)

        if parse_errors:
            file_list = ", ".join(parse_errors.keys())
            await _log(
                f"Syntax errors found in {len(parse_errors)} file(s): {file_list}. "
                "Requesting self-correction...",
                tag="WARN",
            )
            try:
                corrected = await merge_self_correct(merged_files, parse_errors, brief)
                corrected_files = corrected.merged_files

                # Re-validate after self-correction
                remaining_errors = validate_files(corrected_files)

                if remaining_errors:
                    # Merge corrected files but flag the still-failing ones
                    merged_files.update(corrected_files)
                    failing_info = [
                        {
                            "id": f"syntax-{i}",
                            "description": f"Syntax error in {path}: {err}",
                            "resolution": "File included but may contain errors — review manually",
                            "files": [path],
                        }
                        for i, (path, err) in enumerate(remaining_errors.items())
                    ]
                    conflicts.extend(failing_info)
                    await _log(
                        f"Self-correction resolved some issues but {len(remaining_errors)} "
                        f"file(s) still have errors. They are flagged in the conflict report.",
                        tag="WARN",
                    )
                else:
                    merged_files = corrected_files
                    await _log("Self-correction successful — all files pass validation.", tag="INFO")
            except Exception as exc:
                logger.warning("Self-correction pass failed: %s", exc)
                # Add original errors to conflict report and continue
                failing_info = [
                    {
                        "id": f"syntax-{i}",
                        "description": f"Syntax error in {path}: {err}",
                        "resolution": "Self-correction failed — review manually",
                        "files": [path],
                    }
                    for i, (path, err) in enumerate(parse_errors.items())
                ]
                conflicts.extend(failing_info)
                await _log(
                    f"Self-correction pass failed. {len(parse_errors)} file(s) flagged in conflict report.",
                    tag="WARN",
                )
        else:
            await _log("All files passed syntax validation.", tag="INFO")

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
