"""
Standalone test for SandboxProvider.

Proves the full loop: create → write → run → read output → list → delete → destroy.

Usage:
    # Docker (no API key needed):
    SANDBOX_PROVIDER=docker python test_sandbox.py

    # E2B (requires key):
    SANDBOX_PROVIDER=e2b E2B_API_KEY=<your-key> python test_sandbox.py

The script exits 0 on success and 1 on any failure.
"""

import asyncio
import os
import sys

# Allow running from the backend/ directory
sys.path.insert(0, os.path.dirname(__file__))


async def main() -> int:
    # Override settings via env before importing config
    provider_name = os.environ.get("SANDBOX_PROVIDER", "docker")
    os.environ.setdefault("SANDBOX_PROVIDER", provider_name)

    from app.services.sandbox import get_provider, DockerSandboxProvider, E2BSandboxProvider

    print(f"\n{'='*55}")
    print(f"  SandboxProvider smoke test — provider: {provider_name}")
    print(f"{'='*55}\n")

    provider = get_provider()
    print(f"Provider type : {type(provider).__name__}")

    # ── Step 1: Create sandbox ────────────────────────────────────────────────
    print("\n[1] Creating sandbox …", end=" ", flush=True)
    sandbox_id = await provider.create(room_id="test-room", task_id="test-task")
    print(f"OK  (id={sandbox_id[:16]}…)" if len(sandbox_id) > 16 else f"OK  (id={sandbox_id})")

    try:
        # ── Step 2: Write a Python file ───────────────────────────────────────
        print("[2] Writing main.py …", end=" ", flush=True)
        await provider.write_file(
            sandbox_id,
            "main.py",
            'import sys\nprint("Hello from Mosaic sandbox!", flush=True)\nprint(f"Python {sys.version}")\n',
        )
        print("OK")

        # ── Step 3: Write a helper file in a sub-directory ────────────────────
        print("[3] Writing utils/helper.py …", end=" ", flush=True)
        await provider.write_file(
            sandbox_id,
            "utils/helper.py",
            "def greet(name: str) -> str:\n    return f'Hello, {name}!'\n",
        )
        print("OK")

        # ── Step 4: Run the Python file ───────────────────────────────────────
        print("[4] Running 'python main.py' …", end=" ", flush=True)
        result = await provider.run_command(sandbox_id, "python main.py", timeout=20)
        print(f"exit={result.exit_code}")
        if result.stdout:
            for line in result.stdout.strip().splitlines():
                print(f"     stdout | {line}")
        if result.stderr:
            for line in result.stderr.strip().splitlines():
                print(f"     stderr | {line}")
        if not result.ok:
            print("FAIL: non-zero exit code")
            return 1
        if "Hello from Mosaic sandbox!" not in result.stdout:
            print("FAIL: expected output not found")
            return 1

        # ── Step 5: Read file back ─────────────────────────────────────────────
        print("[5] Reading main.py back …", end=" ", flush=True)
        content = await provider.read_file(sandbox_id, "main.py")
        assert "Hello from Mosaic sandbox!" in content, "read-back content mismatch"
        print("OK")

        # ── Step 6: List files ────────────────────────────────────────────────
        print("[6] Listing workspace files …", end=" ", flush=True)
        files = await provider.list_files(sandbox_id)
        names = {f.path for f in files}
        print(f"OK  ({', '.join(sorted(names))})")

        # ── Step 7: Delete a file ─────────────────────────────────────────────
        print("[7] Deleting main.py …", end=" ", flush=True)
        await provider.delete_file(sandbox_id, "main.py")
        print("OK")

        # ── Step 8: Run a failing command (non-zero exit should NOT raise) ─────
        print("[8] Running 'exit 42' (expect exit_code=42) …", end=" ", flush=True)
        bad = await provider.run_command(sandbox_id, "exit 42", timeout=5)
        assert bad.exit_code == 42, f"Expected exit 42, got {bad.exit_code}"
        print(f"OK  (exit={bad.exit_code})")

    finally:
        # ── Step 9: Destroy ───────────────────────────────────────────────────
        print("[9] Destroying sandbox …", end=" ", flush=True)
        await provider.destroy(sandbox_id)
        print("OK")

    print(f"\n{'='*55}")
    print("  ALL STEPS PASSED")
    print(f"{'='*55}\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
