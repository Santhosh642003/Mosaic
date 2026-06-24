"""AI-powered task decomposition service."""

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
    members: list[dict] | None = None,
) -> None:
    """Run decomposition, stream progress, persist tasks, emit completion."""
    try:
        await sio.emit(
            "decomposition_stream",
            {"chunk": "Analyzing project brief...\n", "done": False},
            room=room_code,
        )

        try:
            decomposition = await decompose_brief(brief, language, max_tasks, members)
        except ValueError as exc:
            logger.error("Decomposition structured output failed: %s", exc)
            await sio.emit(
                "decomposition_stream",
                {"chunk": "", "done": True, "error": "Failed to parse decomposition response after retries"},
                room=room_code,
            )
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Room).where(Room.id == room_id))
                room = result.scalar_one_or_none()
                if room:
                    room.status = "waiting"
                    await db.commit()
            return

        await sio.emit(
            "decomposition_stream",
            {"chunk": "Structuring tasks and interface contracts...\n", "done": False},
            room=room_code,
        )

        tasks_data = decomposition.tasks[:max_tasks]

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Room).where(Room.id == room_id))
            room = result.scalar_one_or_none()
            if not room:
                return

            tasks = []
            for i, t in enumerate(tasks_data):
                exposes = [e.model_dump() for e in t.exposes]
                depends_on = [d.model_dump() for d in t.depends_on]
                task = Task(
                    id=str(uuid.uuid4()),
                    room_id=room_id,
                    name=t.name,
                    description=t.description,
                    tech=t.tech,
                    complexity=t.complexity,
                    color=t.color or TASK_COLORS[i % len(TASK_COLORS)],
                    files=t.files,
                    exposes=exposes,
                    depends_on=depends_on,
                    contracts=exposes,  # contracts = exposed interfaces at creation time
                    contract_version=1,
                    contract_history=[],
                    suggested_assignee=(t.suggested_assignee or None),
                    status="unassigned",
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
                    "contract_version": t.contract_version,
                    "suggested_assignee": t.suggested_assignee,
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
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Room).where(Room.id == room_id))
            room = result.scalar_one_or_none()
            if room:
                room.status = "waiting"
                await db.commit()
