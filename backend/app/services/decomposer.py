"""AI-powered task decomposition service."""

import json
import logging
import uuid

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Room, Task
from app.services.llm_service import decompose_brief
from app.socket_manager import sio

logger = logging.getLogger(__name__)

TASK_COLORS = ["#4F8EF7", "#3FB950", "#A371F7", "#D29922", "#F85149", "#58A6FF"]


async def run_decomposition(
    room_id: str,
    room_code: str,
    brief: str,
    language: list[str],
    max_tasks: int,
) -> None:
    """Run decomposition, stream progress, persist tasks, emit completion."""
    try:
        # Notify room decomposition has started
        await sio.emit(
            "decomposition_stream",
            {"chunk": "Analyzing project brief...\n", "done": False},
            room=room_code,
        )

        raw_json = await decompose_brief(brief, language, max_tasks)

        await sio.emit(
            "decomposition_stream",
            {"chunk": "Structuring tasks and interface contracts...\n", "done": False},
            room=room_code,
        )

        # Parse response
        try:
            data = json.loads(raw_json)
            tasks_data = data.get("tasks", [])
        except (json.JSONDecodeError, AttributeError) as exc:
            logger.error("Decomposition JSON parse error: %s\nRaw: %s", exc, raw_json[:500])
            await sio.emit(
                "decomposition_stream",
                {"chunk": "", "done": True, "error": "Failed to parse decomposition response"},
                room=room_code,
            )
            return

        # Persist tasks
        tasks = []
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Room).where(Room.id == room_id))
            room = result.scalar_one_or_none()
            if not room:
                return

            for i, t in enumerate(tasks_data[:max_tasks]):
                task = Task(
                    id=str(uuid.uuid4()),
                    room_id=room_id,
                    name=t.get("name", f"Task {i + 1}"),
                    description=t.get("description", ""),
                    tech=t.get("tech", ""),
                    complexity=t.get("complexity", "medium"),
                    color=t.get("color", TASK_COLORS[i % len(TASK_COLORS)]),
                    files=t.get("files", []),
                    exposes=t.get("exposes", []),
                    depends_on=t.get("depends_on", []),
                    contracts=t.get("exposes", []),  # contracts = exposed interfaces
                    status="pending",
                    code={},
                )
                db.add(task)
                tasks.append(task)

            room.status = "coding"
            await db.commit()

            tasks_payload = [
                {
                    "id": t.id,
                    "name": t.name,
                    "description": t.description,
                    "tech": t.tech,
                    "complexity": t.complexity,
                    "color": t.color,
                    "files": t.files,
                    "exposes": t.exposes,
                    "depends_on": t.depends_on,
                    "contracts": t.contracts,
                    "status": t.status,
                }
                for t in tasks
            ]

        logger.info("decomposition complete: %d tasks for room %s", len(tasks), room_code)

        await sio.emit(
            "decomposition_complete",
            {"tasks": tasks_payload, "room_status": "coding"},
            room=room_code,
        )

    except Exception as exc:
        logger.exception("Decomposition error for room %s: %s", room_code, exc)
        await sio.emit(
            "decomposition_stream",
            {"chunk": "", "done": True, "error": str(exc)},
            room=room_code,
        )
        # Revert room status
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Room).where(Room.id == room_id))
            room = result.scalar_one_or_none()
            if room:
                room.status = "waiting"
                await db.commit()
