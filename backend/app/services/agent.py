"""
Step-2 agent loop.

run_agent() drives an LLM through a tool-use loop against a real sandbox:

    instruction → [LLM → tool_calls → execute → results] × MAX_STEPS → done

Tools available to the agent:
  list_files  read_file  write_file  edit_file  delete_file  run_command  task_complete

All file operations are relative to WORKSPACE_DIR (/workspace).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable
from dataclasses import dataclass, field
from typing import Any, Callable

from groq import AsyncGroq

from app.config import settings
from app.services.sandbox import SandboxProvider

logger = logging.getLogger(__name__)

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are Mosaic Agent, an expert software engineer with access to a live coding sandbox.
You build real, working software by calling tools — not by describing what you would do.

Ground rules
============
1. Think before acting: plan the minimal set of steps, then execute them.
2. After writing code, ALWAYS run it to verify it works.
3. If a command fails, read stderr carefully, fix the root cause, and retry.
4. For long-running processes (servers, watchers), run them in the background:
       uvicorn main:app --port 8000 & sleep 1 && curl -s http://localhost:8000/health
5. Never assume a step succeeded without evidence from stdout/exit_code.
6. Call task_complete ONLY after you have run and verified the final output.

File paths are relative to /workspace. You are the only agent in this sandbox.
"""

# ── Tool definitions (Groq / OpenAI schema) ───────────────────────────────────

TOOL_DEFINITIONS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files and directories at a path in the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to list (default '.').",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the complete contents of a file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative file path."}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write (or overwrite) a file with complete content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {
                        "type": "string",
                        "description": "Complete file content — never a diff or partial snippet.",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Replace an exact string in an existing file. "
                "old_str must appear verbatim in the file exactly once."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "old_str": {
                        "type": "string",
                        "description": "Exact substring to replace.",
                    },
                    "new_str": {
                        "type": "string",
                        "description": "Replacement string (may be empty to delete).",
                    },
                },
                "required": ["path", "old_str", "new_str"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file from the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative file path."}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Run a shell command in /workspace. "
                "Returns stdout, stderr, and exit_code. "
                "Append & to run in background (e.g. for servers). "
                "Use timeout if the command may hang."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string", "description": "Shell command to execute."},
                    "timeout": {
                        "type": "integer",
                        "description": "Max seconds to wait (default 30).",
                    },
                },
                "required": ["cmd"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_complete",
            "description": (
                "Signal that the task is fully done and verified. "
                "Call this only after confirming the solution works."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Short description of what was built and verified.",
                    },
                    "files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Paths of files created or modified.",
                    },
                },
                "required": ["summary"],
            },
        },
    },
]

# ── Events ────────────────────────────────────────────────────────────────────

@dataclass
class AgentEvent:
    """Single event emitted during the agent loop — for streaming / logging."""

    type: str  # "thinking" | "tool_call" | "tool_result" | "complete" | "error" | "step"
    step: int = 0
    # thinking
    content: str = ""
    # tool call
    tool_name: str = ""
    tool_args: dict = field(default_factory=dict)
    # tool result
    tool_result: dict = field(default_factory=dict)
    # complete
    summary: str = ""
    files: list[str] = field(default_factory=list)
    # error
    error: str = ""


# ── Tool executor ─────────────────────────────────────────────────────────────

async def execute_tool(
    name: str,
    args: dict,
    sandbox_id: str,
    provider: SandboxProvider,
) -> dict:
    """Dispatch a tool call to the sandbox and return a JSON-serialisable result."""
    try:
        if name == "list_files":
            nodes = await provider.list_files(sandbox_id, args.get("path", "."))
            return {
                "files": [
                    {"path": n.path, "is_dir": n.is_dir, "size": n.size} for n in nodes
                ]
            }

        if name == "read_file":
            content = await provider.read_file(sandbox_id, args["path"])
            return {"content": content}

        if name == "write_file":
            await provider.write_file(sandbox_id, args["path"], args["content"])
            return {"ok": True, "path": args["path"]}

        if name == "edit_file":
            existing = await provider.read_file(sandbox_id, args["path"])
            old_str = args["old_str"]
            if old_str not in existing:
                return {
                    "ok": False,
                    "error": f"old_str not found in {args['path']}",
                }
            new_content = existing.replace(old_str, args["new_str"], 1)
            await provider.write_file(sandbox_id, args["path"], new_content)
            return {"ok": True, "path": args["path"]}

        if name == "delete_file":
            await provider.delete_file(sandbox_id, args["path"])
            return {"ok": True}

        if name == "run_command":
            result = await provider.run_command(
                sandbox_id, args["cmd"], args.get("timeout", 30)
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.exit_code,
            }

        if name == "task_complete":
            return {
                "status": "complete",
                "summary": args.get("summary", ""),
                "files": args.get("files", []),
            }

        return {"error": f"Unknown tool: {name}"}

    except Exception as exc:  # noqa: BLE001
        logger.warning("Tool %s raised %s", name, exc)
        return {"error": str(exc)}


# ── Agent loop ────────────────────────────────────────────────────────────────

async def run_agent(
    instruction: str,
    sandbox_id: str,
    provider: SandboxProvider,
    *,
    model: str | None = None,
    max_steps: int | None = None,
    on_event: Callable[[AgentEvent], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """
    Drive the LLM tool loop until task_complete or max_steps.

    Returns the task_complete payload on success, or a dict with
    {"status": "incomplete", "reason": ...} on failure / cap.
    """
    _model = model or settings.coding_model
    _max_steps = max_steps or settings.agent_max_steps
    client = AsyncGroq(api_key=settings.groq_api_key)

    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": instruction},
    ]

    async def emit(event: AgentEvent) -> None:
        if on_event is not None:
            await on_event(event)

    for step in range(_max_steps):
        await emit(AgentEvent(type="step", step=step))

        # ── LLM call ──────────────────────────────────────────────────────────
        try:
            response = await client.chat.completions.create(
                model=_model,
                messages=messages,
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
                temperature=0.1,
                max_tokens=4096,
            )
        except Exception as exc:
            err = f"LLM call failed at step {step}: {exc}"
            logger.error(err)
            await emit(AgentEvent(type="error", step=step, error=err))
            return {"status": "error", "reason": err}

        msg = response.choices[0].message

        # ── Agent thinking (text before tool calls) ────────────────────────────
        if msg.content:
            await emit(AgentEvent(type="thinking", step=step, content=msg.content))

        # ── No tool calls → agent is stuck or done without calling task_complete
        if not msg.tool_calls:
            reason = msg.content or "(no tool calls and no explanation)"
            logger.warning("Agent produced no tool calls at step %d — stopping", step)
            return {"status": "incomplete", "reason": reason}

        # ── Append assistant message (preserve tool_calls for context) ─────────
        messages.append(
            {
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ],
            }
        )

        # ── Execute each tool call in order ───────────────────────────────────
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                args = {}

            await emit(
                AgentEvent(
                    type="tool_call",
                    step=step,
                    tool_name=tc.function.name,
                    tool_args=args,
                )
            )

            result = await execute_tool(tc.function.name, args, sandbox_id, provider)

            await emit(
                AgentEvent(
                    type="tool_result",
                    step=step,
                    tool_name=tc.function.name,
                    tool_result=result,
                )
            )

            # Append tool result for the next LLM turn
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result),
                }
            )

            # ── task_complete → return immediately ─────────────────────────────
            if tc.function.name == "task_complete" and result.get("status") == "complete":
                await emit(
                    AgentEvent(
                        type="complete",
                        step=step,
                        summary=result.get("summary", ""),
                        files=result.get("files", []),
                    )
                )
                return result

    # Exhausted max_steps without task_complete
    reason = f"Reached max_steps={_max_steps} without calling task_complete"
    logger.warning(reason)
    await emit(AgentEvent(type="error", step=_max_steps, error=reason))
    return {"status": "incomplete", "reason": reason}
