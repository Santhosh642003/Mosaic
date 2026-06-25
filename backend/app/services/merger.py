"""AI-powered codebase merge service — iterative cycle edition.

Flow per attempt:
  1. Collect submitted task code from DB
  2. AI merge (structured) + AST self-correct pass
  3. Create a DEDICATED INTEGRATION SANDBOX
  4. Write merged files into sandbox
  5. Detect project type → install deps → run project
  6. Stream sandbox terminal output live to room
  7. Emit merge_complete with run_result (ok/failed + stdout/stderr)
  8. Set room.status = "coding" so the team can iterate (NOT "complete")
     The room only reaches "complete" when the lead explicitly closes it.

Task sandboxes are NOT destroyed between iterations — they stay alive until
the room is explicitly closed (task_session_end / room delete).
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models import Merge, Room, Task
from app.services.ast_validator import validate_files
from app.services.llm_service import merge_codebases, merge_self_correct
from app.services.sandbox import get_provider
from app.socket_manager import sio

logger = logging.getLogger(__name__)

# ── integration sandbox registry (room_id → sandbox_id) ─────────────────────
_integration_sandboxes: dict[str, str] = {}


async def run_merge(room_id: str, room_code: str) -> None:
    """Run one merge attempt: AI merge → integration sandbox → run → stream → result."""
    provider = get_provider()

    async def _log(msg: str, tag: str = "INFO") -> None:
        await sio.emit(
            "merge_log_stream",
            {"message": msg, "tag": tag, "done": False},
            room=room_code,
        )

    async def _done_log(msg: str, tag: str = "INFO") -> None:
        await sio.emit(
            "merge_log_stream",
            {"message": msg, "tag": tag, "done": True},
            room=room_code,
        )

    try:
        # ── 1. Collect tasks + room info ─────────────────────────────────────
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
            # Count previous merge attempts for this room
            attempt_result = await db.execute(
                select(func.count()).where(Merge.room_id == room_id)
            )
            attempt_num = (attempt_result.scalar() or 0) + 1

        if not tasks:
            await _done_log("No completed tasks to merge.", tag="WARN")
            return

        await _log(f"[Attempt #{attempt_num}] Collecting {len(tasks)} submitted task(s)…")

        tasks_payload = [
            {"name": t.name, "description": t.description, "code": t.code or {}}
            for t in tasks
        ]

        # ── 2. AI merge ───────────────────────────────────────────────────────
        await _log("Running AI semantic merge…")
        try:
            merge_result = await merge_codebases(tasks_payload, brief)
        except ValueError as exc:
            logger.error("Merge structured output failed: %s", exc)
            await _done_log(f"AI merge failed: {exc}", tag="ERROR")
            await sio.emit("merge_error", {"message": f"AI merge failed: {exc}"}, room=room_code)
            async with AsyncSessionLocal() as db:
                r = await db.execute(select(Room).where(Room.id == room_id))
                rm = r.scalar_one_or_none()
                if rm:
                    rm.status = "coding"
                    await db.commit()
            return

        merged_files: dict[str, str] = merge_result.merged_files
        diff_report = [e.model_dump() for e in merge_result.diff_report]
        conflicts = [e.model_dump() for e in merge_result.conflicts]

        await _log(f"AI merged {len(merged_files)} file(s). Running syntax validation…")

        # ── 3. AST validation + one self-correct pass ─────────────────────────
        parse_errors = validate_files(merged_files)
        if parse_errors:
            file_list = ", ".join(parse_errors.keys())
            await _log(
                f"Syntax errors in {len(parse_errors)} file(s): {file_list}. Self-correcting…",
                tag="WARN",
            )
            try:
                corrected = await merge_self_correct(merged_files, parse_errors, brief)
                remaining = validate_files(corrected.merged_files)
                if remaining:
                    merged_files.update(corrected.merged_files)
                    conflicts.extend([
                        {
                            "id": f"syntax-{i}",
                            "description": f"Syntax error in {p}: {e}",
                            "resolution": "Included with errors — review manually",
                            "files": [p],
                        }
                        for i, (p, e) in enumerate(remaining.items())
                    ])
                    await _log(f"{len(remaining)} file(s) still have errors after self-correction.", tag="WARN")
                else:
                    merged_files = corrected.merged_files
                    await _log("Self-correction successful.", tag="INFO")
            except Exception as exc:
                logger.warning("Self-correction failed: %s", exc)
                conflicts.extend([
                    {
                        "id": f"syntax-{i}",
                        "description": f"Syntax error in {p}: {e}",
                        "resolution": "Self-correction failed — review manually",
                        "files": [p],
                    }
                    for i, (p, e) in enumerate(parse_errors.items())
                ])
        else:
            await _log("All files passed syntax validation.", tag="INFO")

        # ── 4. Integration sandbox ────────────────────────────────────────────
        # Destroy stale integration sandbox from a previous attempt if any
        old_sandbox = _integration_sandboxes.pop(room_id, None)
        if old_sandbox:
            try:
                await provider.destroy(old_sandbox)
            except Exception:
                pass

        await _log("Creating integration sandbox…")
        try:
            sandbox_id = await provider.create(room_id, "integration")
            _integration_sandboxes[room_id] = sandbox_id
        except Exception as exc:
            logger.error("Failed to create integration sandbox: %s", exc)
            await _done_log(f"Sandbox creation failed: {exc}", tag="ERROR")
            await sio.emit("merge_error", {"message": f"Sandbox error: {exc}"}, room=room_code)
            async with AsyncSessionLocal() as db:
                r = await db.execute(select(Room).where(Room.id == room_id))
                rm = r.scalar_one_or_none()
                if rm:
                    rm.status = "coding"
                    await db.commit()
            return

        # ── 5. Write merged files into integration sandbox ────────────────────
        await _log(f"Writing {len(merged_files)} file(s) into integration sandbox…")
        for path, content in merged_files.items():
            try:
                await provider.write_file(sandbox_id, path, content)
            except Exception as exc:
                logger.warning("Failed to write %s to integration sandbox: %s", path, exc)

        # ── 6. Detect project type + install deps ─────────────────────────────
        run_stdout = ""
        run_stderr = ""
        run_ok = False
        start_cmd: str | None = None

        has_requirements = "requirements.txt" in merged_files
        has_package_json = "package.json" in merged_files
        has_pyproject = "pyproject.toml" in merged_files

        if has_requirements or has_pyproject:
            await _log("Detected Python project. Installing dependencies…")
            dep_cmd = "pip install -r requirements.txt -q" if has_requirements else "pip install -e . -q"
            dep_result = await _stream_cmd(sandbox_id, dep_cmd, room_code, provider)
            if not dep_result.ok:
                await _log(f"Dependency install warnings (exit {dep_result.exit_code}).", tag="WARN")

            # Look for a main entry point
            if "main.py" in merged_files:
                start_cmd = "python main.py"
            elif "app.py" in merged_files:
                start_cmd = "python app.py"
            elif "server.py" in merged_files:
                start_cmd = "python server.py"
            else:
                # Find any .py file with __main__ or run the first .py
                py_files = [p for p in merged_files if p.endswith(".py") and "/" not in p]
                if py_files:
                    start_cmd = f"python {py_files[0]}"

        elif has_package_json:
            await _log("Detected Node.js project. Installing dependencies…")
            dep_result = await _stream_cmd(sandbox_id, "npm install --prefer-offline 2>&1", room_code, provider)
            if not dep_result.ok:
                await _log(f"npm install warnings (exit {dep_result.exit_code}).", tag="WARN")

            # Detect start script
            import json as _json
            try:
                pkg = _json.loads(merged_files["package.json"])
                scripts = pkg.get("scripts", {})
                if "start" in scripts:
                    start_cmd = "npm start"
                elif "dev" in scripts:
                    start_cmd = "npm run dev"
            except Exception:
                pass
            if not start_cmd:
                if "index.js" in merged_files:
                    start_cmd = "node index.js"
                elif "server.js" in merged_files:
                    start_cmd = "node server.js"

        else:
            # Generic: try to run first .py or .js file found
            py_files = [p for p in merged_files if p.endswith(".py") and "/" not in p]
            js_files = [p for p in merged_files if p.endswith(".js") and "/" not in p]
            if py_files:
                start_cmd = f"python {py_files[0]}"
            elif js_files:
                start_cmd = f"node {js_files[0]}"

        # ── 7. Run project + smoke check ──────────────────────────────────────
        run_result_data: dict = {"ok": False, "stdout": "", "stderr": "", "cmd": None}

        if start_cmd:
            await _log(f"Running project: {start_cmd}")
            try:
                # Run with a 20s timeout — web servers will time out but we capture initial output
                run_res = await _stream_cmd(sandbox_id, start_cmd, room_code, provider, timeout=20)
                run_stdout = run_res.stdout
                run_stderr = run_res.stderr
                # exit_code 124 = timeout (acceptable for long-running servers), 0 = clean exit
                run_ok = run_res.exit_code in (0, 124)
                run_result_data = {
                    "ok": run_ok,
                    "cmd": start_cmd,
                    "stdout": run_stdout[:4000],
                    "stderr": run_stderr[:2000],
                    "exit_code": run_res.exit_code,
                }
                if run_ok:
                    await _log(
                        f"Project ran successfully (exit {run_res.exit_code}).",
                        tag="SUCCESS",
                    )
                else:
                    await _log(
                        f"Project exited with code {run_res.exit_code}.",
                        tag="WARN",
                    )
            except Exception as exc:
                run_result_data = {"ok": False, "cmd": start_cmd, "error": str(exc), "stdout": "", "stderr": ""}
                await _log(f"Run failed: {exc}", tag="ERROR")
        else:
            await _log("No runnable entry point detected — skipping execution.", tag="WARN")
            run_result_data = {"ok": None, "cmd": None, "note": "No entry point found"}

        # ── 8. Persist merge record ───────────────────────────────────────────
        async with AsyncSessionLocal() as db:
            merge_record = Merge(
                id=str(uuid.uuid4()),
                room_id=room_id,
                merged_files=merged_files,
                diff_report=diff_report,
                conflicts=conflicts,
                attempt=attempt_num,
                run_result=run_result_data,
                created_at=datetime.now(timezone.utc),
            )
            db.add(merge_record)

            # Keep room in "coding" so the team can iterate.
            # The room only moves to "complete" when the lead explicitly closes it.
            r = await db.execute(select(Room).where(Room.id == room_id))
            rm = r.scalar_one_or_none()
            if rm:
                rm.status = "coding"

            await db.commit()
            merge_id = merge_record.id

        logger.info("merge attempt #%d complete for room %s", attempt_num, room_code)

        await _done_log(
            f"Attempt #{attempt_num} complete. Run: {'OK' if run_result_data.get('ok') else 'FAILED' if run_result_data.get('ok') is False else 'SKIPPED'}.",
            tag="SUCCESS" if run_result_data.get("ok") else "WARN",
        )

        await sio.emit(
            "merge_complete",
            {
                "merge_id": merge_id,
                "attempt": attempt_num,
                "file_count": len(merged_files),
                "conflict_count": len(conflicts),
                "run_result": run_result_data,
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
            r = await db.execute(select(Room).where(Room.id == room_id))
            rm = r.scalar_one_or_none()
            if rm:
                rm.status = "coding"
                await db.commit()


async def _stream_cmd(
    sandbox_id: str,
    cmd: str,
    room_code: str,
    provider,
    timeout: int = 60,
) -> "CommandResult":  # type: ignore[name-defined]  # noqa: F821
    """Run a command in the sandbox, stream terminal output to the room, return result."""
    from app.services.sandbox import CommandResult

    await sio.emit(
        "merge_terminal",
        {"cmd": cmd, "source": "integration"},
        room=room_code,
    )

    try:
        result = await asyncio.wait_for(
            provider.run_command(sandbox_id, cmd),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        result = CommandResult(stdout="[timeout]", stderr="", exit_code=124)

    await sio.emit(
        "merge_terminal",
        {
            "cmd": cmd,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.exit_code,
            "done": True,
            "source": "integration",
        },
        room=room_code,
    )
    return result


async def destroy_integration_sandbox(room_id: str) -> None:
    """Destroy the integration sandbox for a room (called on room close)."""
    sandbox_id = _integration_sandboxes.pop(room_id, None)
    if sandbox_id:
        provider = get_provider()
        try:
            await provider.destroy(sandbox_id)
        except Exception as exc:
            logger.warning("Failed to destroy integration sandbox %s: %s", sandbox_id, exc)
