"""
Standalone test for the Step-2 agent loop.

The agent is given a single instruction:
  "Create a FastAPI app with a /health endpoint that returns {status: ok},
   install dependencies, start the server, and verify it responds."

The agent must:
  1. Write main.py
  2. pip install fastapi uvicorn
  3. Start uvicorn in the background
  4. curl /health to verify
  5. Call task_complete

We stream every event to stdout so you can watch the agent think, call tools,
and self-correct in real time.

Usage:
    SANDBOX_PROVIDER=docker \
    GROQ_API_KEY=<key> \
    python test_agent.py
"""

import asyncio
import os
import sys
import textwrap

sys.path.insert(0, os.path.dirname(__file__))


INSTRUCTION = textwrap.dedent("""\
    Create a FastAPI application that exposes a single endpoint:

        GET /health  →  {"status": "ok"}

    Steps:
    1. Write the application to main.py.
    2. Install fastapi and uvicorn (pip install fastapi uvicorn[standard]).
    3. Start the server on port 8000 in the background and verify it responds —
       combine server start + wait + HTTP check into ONE run_command so the
       port has time to bind. Use Python urllib for the HTTP check (curl is NOT
       available):
           uvicorn main:app --host 0.0.0.0 --port 8000 &
           sleep 2 &&
           python -c "import urllib.request; r=urllib.request.urlopen('http://localhost:8000/health'); print(r.status, r.read())"
       The python check must print the response body and exit 0.
    4. Confirm the HTTP response body contains "ok".
    5. Call task_complete with a summary of what you built and verified.

    IMPORTANT: Do NOT use curl, wget, or any tool you have not explicitly
    installed. The sandbox only has Python 3.11 and pip available by default.
""")


# ── Pretty printer ────────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
CYAN   = "\033[36m"
YELLOW = "\033[33m"
GREEN  = "\033[32m"
RED    = "\033[31m"
MAGENTA = "\033[35m"


def hr(char: str = "─", width: int = 60) -> str:
    return char * width


def _indent(text: str, prefix: str = "  ") -> str:
    return "\n".join(prefix + line for line in text.splitlines())


async def on_event(event) -> None:  # noqa: ANN001
    from app.services.agent import AgentEvent

    if event.type == "step":
        print(f"\n{CYAN}{BOLD}── Step {event.step + 1} {hr('─', 50)}{RESET}")

    elif event.type == "thinking":
        print(f"{DIM}💭 Agent thinking:{RESET}")
        print(_indent(event.content, "   "))

    elif event.type == "tool_call":
        icon = {
            "list_files":   "📂",
            "read_file":    "📖",
            "write_file":   "✏️ ",
            "edit_file":    "🔧",
            "delete_file":  "🗑️ ",
            "run_command":  "⚡",
            "task_complete": "✅",
        }.get(event.tool_name, "🔨")

        print(f"{YELLOW}{BOLD}{icon} {event.tool_name}{RESET}", end="")

        if event.tool_name == "run_command":
            print(f"  $ {event.tool_args.get('cmd', '')}")
        elif event.tool_name == "write_file":
            path = event.tool_args.get("path", "")
            lines = event.tool_args.get("content", "").count("\n") + 1
            print(f"  {path}  ({lines} lines)")
        elif event.tool_name == "read_file":
            print(f"  {event.tool_args.get('path', '')}")
        elif event.tool_name == "edit_file":
            print(f"  {event.tool_args.get('path', '')}")
        elif event.tool_name == "task_complete":
            print(f"  summary: {event.tool_args.get('summary', '')[:80]}")
        else:
            print(f"  {event.tool_args}")

    elif event.type == "tool_result":
        r = event.tool_result

        if event.tool_name == "run_command":
            ec = r.get("exit_code", "?")
            colour = GREEN if ec == 0 else RED
            print(f"   {colour}exit={ec}{RESET}", end="")
            if r.get("stdout", "").strip():
                print(f"  stdout: {r['stdout'].strip()[:200]}")
            else:
                print()
            if r.get("stderr", "").strip():
                print(f"   {DIM}stderr: {r['stderr'].strip()[:200]}{RESET}")

        elif event.tool_name == "read_file":
            content = r.get("content", "")
            preview = content[:300].replace("\n", "↵ ")
            print(f"   {DIM}→ {len(content)} chars{RESET}  {preview[:80]}…" if len(content) > 80 else f"   {DIM}→ {content!r}{RESET}")

        elif event.tool_name == "list_files":
            files = r.get("files", [])
            print(f"   {DIM}{files}{RESET}")

        elif event.tool_name == "write_file" or event.tool_name == "edit_file":
            ok = r.get("ok", False)
            colour = GREEN if ok else RED
            print(f"   {colour}{'OK' if ok else r.get('error', 'FAIL')}{RESET}")

        elif event.tool_name == "task_complete":
            print(f"   {GREEN}COMPLETE{RESET}  {r.get('summary', '')}")

        else:
            print(f"   {DIM}{r}{RESET}")

    elif event.type == "complete":
        print(f"\n{GREEN}{BOLD}{hr('═')}{RESET}")
        print(f"{GREEN}{BOLD}  TASK COMPLETE — step {event.step + 1}{RESET}")
        print(f"  {event.summary}")
        if event.files:
            print(f"  Files: {', '.join(event.files)}")
        print(f"{GREEN}{BOLD}{hr('═')}{RESET}\n")

    elif event.type == "error":
        if "REJECTED" in event.error:
            # Guard triggered — make it stand out
            print(f"\n{MAGENTA}{BOLD}🚫 GUARD: {event.error}{RESET}\n")
        else:
            print(f"\n{RED}{BOLD}ERROR at step {event.step}: {event.error}{RESET}\n")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main() -> int:
    os.environ.setdefault("SANDBOX_PROVIDER", "docker")

    from app.services.sandbox import get_provider
    from app.services.agent import run_agent, AgentEvent

    provider_name = os.environ.get("SANDBOX_PROVIDER", "docker")
    print(f"\n{BOLD}{hr('═')}{RESET}")
    print(f"{BOLD}  Mosaic Agent — Step 2 smoke test{RESET}")
    print(f"  Sandbox provider : {provider_name}")
    print(f"  Model            : {os.environ.get('CODING_MODEL', 'llama-3.3-70b-versatile')}")
    print(f"{BOLD}{hr('═')}{RESET}")
    print(f"\n{BOLD}Instruction:{RESET}")
    print(_indent(INSTRUCTION.strip(), "  "))

    provider = get_provider()

    print(f"\n{CYAN}Creating sandbox…{RESET}")
    sandbox_id = await provider.create(room_id="test-room", task_id="health-api")
    print(f"Sandbox ID: {sandbox_id[:24]}…\n")

    try:
        result = await run_agent(
            instruction=INSTRUCTION,
            sandbox_id=sandbox_id,
            provider=provider,
            on_event=on_event,
        )
    finally:
        print(f"\n{CYAN}Destroying sandbox…{RESET}", end=" ")
        await provider.destroy(sandbox_id)
        print("done")

    print(f"\nFinal result: {result}")

    success = result.get("status") == "complete"
    if success:
        print(f"\n{GREEN}{BOLD}✓ Agent completed the task successfully.{RESET}\n")
        return 0
    else:
        print(f"\n{RED}{BOLD}✗ Agent did not complete the task.{RESET}\n")
        print(f"  Reason: {result.get('reason', '?')}\n")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
