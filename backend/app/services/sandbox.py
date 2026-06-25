"""
SandboxProvider abstraction.

Two implementations are available:
  - E2BSandboxProvider   (primary)   — cloud sandboxes via e2b
  - DockerSandboxProvider (fallback) — local Docker containers

Selected at startup via settings.sandbox_provider ("e2b" | "docker").

Public API
----------
provider = get_provider()
sandbox_id = await provider.create(room_id, task_id)
await provider.write_file(sandbox_id, "main.py", "print('hi')")
result = await provider.run_command(sandbox_id, "python main.py")
files = await provider.list_files(sandbox_id)
content = await provider.read_file(sandbox_id, "main.py")
await provider.delete_file(sandbox_id, "main.py")
await provider.destroy(sandbox_id)
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import tarfile
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

WORKSPACE_DIR = "/workspace"


# ── Value objects ─────────────────────────────────────────────────────────────

@dataclass
class FileNode:
    path: str
    is_dir: bool
    size: int = 0


@dataclass
class CommandResult:
    stdout: str
    stderr: str
    exit_code: int

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


# ── Protocol ──────────────────────────────────────────────────────────────────

@runtime_checkable
class SandboxProvider(Protocol):
    """Interface every sandbox backend must implement."""

    async def create(self, room_id: str, task_id: str) -> str:
        """
        Spin up a fresh sandbox scoped to (room_id, task_id).
        Returns an opaque sandbox_id used in every subsequent call.
        """
        ...

    async def write_file(self, sandbox_id: str, path: str, content: str) -> None:
        """Write (or overwrite) a file at *path* relative to WORKSPACE_DIR."""
        ...

    async def read_file(self, sandbox_id: str, path: str) -> str:
        """Read a file at *path* relative to WORKSPACE_DIR."""
        ...

    async def list_files(self, sandbox_id: str, path: str = ".") -> list[FileNode]:
        """List files/dirs at *path* relative to WORKSPACE_DIR (non-recursive)."""
        ...

    async def delete_file(self, sandbox_id: str, path: str) -> None:
        """Delete a file or empty directory at *path* relative to WORKSPACE_DIR."""
        ...

    async def run_command(
        self, sandbox_id: str, cmd: str, timeout: int = 30
    ) -> CommandResult:
        """
        Run a shell command inside the sandbox with WORKSPACE_DIR as cwd.
        Always returns a CommandResult — never raises on non-zero exit codes.
        """
        ...

    async def destroy(self, sandbox_id: str) -> None:
        """Shut down and clean up the sandbox."""
        ...


# ── E2B implementation ────────────────────────────────────────────────────────

class E2BSandboxProvider:
    """
    Cloud sandbox via the e2b Python SDK.
    Requires E2B_API_KEY in the environment.

    Each sandbox_id returned by create() IS the E2B sandbox ID, which means
    it survives server restarts — reconnect with Sandbox.reconnect(sandbox_id).
    """

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        # cache live Sandbox objects to avoid repeated reconnects
        self._sandboxes: dict[str, Any] = {}

    def _full_path(self, path: str) -> str:
        if os.path.isabs(path):
            return path
        return f"{WORKSPACE_DIR}/{path}"

    def _get_sandbox(self, sandbox_id: str) -> Any:
        """Return cached sandbox or reconnect."""
        if sandbox_id not in self._sandboxes:
            from e2b import Sandbox  # type: ignore[import]
            sb = Sandbox.reconnect(sandbox_id, api_key=self._api_key)
            self._sandboxes[sandbox_id] = sb
        return self._sandboxes[sandbox_id]

    async def create(self, room_id: str, task_id: str) -> str:
        from e2b import Sandbox  # type: ignore[import]

        def _create() -> Any:
            sb = Sandbox(api_key=self._api_key, timeout=300)
            sb.commands.run(f"mkdir -p {WORKSPACE_DIR}", timeout=10)
            return sb

        sb = await asyncio.to_thread(_create)
        sid = sb.sandbox_id
        self._sandboxes[sid] = sb
        logger.info("e2b sandbox created: %s (room=%s task=%s)", sid, room_id, task_id)
        return sid

    async def write_file(self, sandbox_id: str, path: str, content: str) -> None:
        full = self._full_path(path)
        sb = self._get_sandbox(sandbox_id)

        def _write() -> None:
            # Ensure parent directory exists
            parent = "/".join(full.split("/")[:-1])
            if parent:
                sb.commands.run(f"mkdir -p {parent}", timeout=10)
            sb.files.write(full, content)

        await asyncio.to_thread(_write)

    async def read_file(self, sandbox_id: str, path: str) -> str:
        full = self._full_path(path)
        sb = self._get_sandbox(sandbox_id)
        return await asyncio.to_thread(sb.files.read, full)

    async def list_files(self, sandbox_id: str, path: str = ".") -> list[FileNode]:
        full = self._full_path(path)
        sb = self._get_sandbox(sandbox_id)

        def _list() -> list[FileNode]:
            entries = sb.files.list(full)
            nodes: list[FileNode] = []
            for e in entries:
                # EntryInfo has .name, .type ("file"|"dir"), .path
                is_dir = getattr(e, "type", "file") == "dir"
                node_path = getattr(e, "name", getattr(e, "path", str(e)))
                nodes.append(FileNode(path=node_path, is_dir=is_dir))
            return nodes

        return await asyncio.to_thread(_list)

    async def delete_file(self, sandbox_id: str, path: str) -> None:
        full = self._full_path(path)
        sb = self._get_sandbox(sandbox_id)
        await asyncio.to_thread(sb.files.remove, full)

    async def run_command(
        self, sandbox_id: str, cmd: str, timeout: int = 30
    ) -> CommandResult:
        sb = self._get_sandbox(sandbox_id)

        def _run() -> CommandResult:
            result = sb.commands.run(
                cmd,
                cwd=WORKSPACE_DIR,
                timeout=timeout,
            )
            return CommandResult(
                stdout=result.stdout or "",
                stderr=result.stderr or "",
                exit_code=result.exit_code if result.exit_code is not None else 0,
            )

        return await asyncio.to_thread(_run)

    async def destroy(self, sandbox_id: str) -> None:
        sb = self._sandboxes.pop(sandbox_id, None)
        if sb is not None:
            await asyncio.to_thread(sb.close)
            logger.info("e2b sandbox destroyed: %s", sandbox_id)


# ── Docker implementation ─────────────────────────────────────────────────────

_DOCKER_IMAGE = "python:3.11-slim"


class DockerSandboxProvider:
    """
    Local Docker sandbox — one container per (room, task).

    The container runs an idle process (sleep infinity) so we can exec into it.
    Requires Docker to be accessible (socket mounted into the backend container,
    or running directly on the host).
    """

    def __init__(self) -> None:
        self._containers: dict[str, Any] = {}  # sandbox_id -> Container

    def _client(self) -> Any:
        import docker  # type: ignore[import]
        return docker.from_env()

    def _get_container(self, sandbox_id: str) -> Any:
        c = self._containers.get(sandbox_id)
        if c is None:
            raise KeyError(f"No active sandbox: {sandbox_id}")
        return c

    async def create(self, room_id: str, task_id: str) -> str:
        def _create() -> Any:
            client = self._client()
            try:
                client.images.get(_DOCKER_IMAGE)
            except Exception:
                logger.info("Pulling Docker image %s …", _DOCKER_IMAGE)
                client.images.pull(_DOCKER_IMAGE)

            container = client.containers.run(
                _DOCKER_IMAGE,
                command=["sh", "-c", f"mkdir -p {WORKSPACE_DIR} && sleep infinity"],
                detach=True,
                remove=False,
                labels={
                    "mosaic.room_id": room_id,
                    "mosaic.task_id": task_id,
                },
                working_dir=WORKSPACE_DIR,
            )
            return container

        container = await asyncio.to_thread(_create)
        sid = container.id
        self._containers[sid] = container
        logger.info("docker sandbox created: %s (room=%s task=%s)", sid[:12], room_id, task_id)
        return sid

    def _write_tar(self, path: str, content: str) -> io.BytesIO:
        """Build an in-memory tar containing a single file at *path*."""
        buf = io.BytesIO()
        encoded = content.encode()
        info = tarfile.TarInfo(name=os.path.basename(path))
        info.size = len(encoded)
        with tarfile.open(fileobj=buf, mode="w") as tf:
            tf.addfile(info, io.BytesIO(encoded))
        buf.seek(0)
        return buf

    def _full_path(self, path: str) -> str:
        if os.path.isabs(path):
            return path
        return f"{WORKSPACE_DIR}/{path}"

    async def write_file(self, sandbox_id: str, path: str, content: str) -> None:
        full = self._full_path(path)
        container = self._get_container(sandbox_id)

        def _write() -> None:
            parent = os.path.dirname(full)
            container.exec_run(["mkdir", "-p", parent])
            tar_buf = self._write_tar(full, content)
            container.put_archive(parent, tar_buf)

        await asyncio.to_thread(_write)

    async def read_file(self, sandbox_id: str, path: str) -> str:
        full = self._full_path(path)
        container = self._get_container(sandbox_id)

        def _read() -> str:
            result = container.exec_run(["cat", full])
            if result.exit_code != 0:
                raise FileNotFoundError(f"File not found in sandbox: {path}")
            return result.output.decode(errors="replace")

        return await asyncio.to_thread(_read)

    async def list_files(self, sandbox_id: str, path: str = ".") -> list[FileNode]:
        full = self._full_path(path)
        container = self._get_container(sandbox_id)

        def _list() -> list[FileNode]:
            # format: "type size name" per entry
            result = container.exec_run(
                ["find", full, "-maxdepth", "1", "-mindepth", "1",
                 "-printf", "%y %s %f\n"]
            )
            output = result.output.decode(errors="replace").strip()
            nodes: list[FileNode] = []
            for line in output.splitlines():
                parts = line.split(" ", 2)
                if len(parts) < 3:
                    continue
                ftype, size_str, name = parts
                try:
                    size = int(size_str)
                except ValueError:
                    size = 0
                nodes.append(FileNode(path=name, is_dir=(ftype == "d"), size=size))
            return nodes

        return await asyncio.to_thread(_list)

    async def delete_file(self, sandbox_id: str, path: str) -> None:
        full = self._full_path(path)
        container = self._get_container(sandbox_id)
        await asyncio.to_thread(container.exec_run, ["rm", "-rf", full])

    async def run_command(
        self, sandbox_id: str, cmd: str, timeout: int = 30
    ) -> CommandResult:
        container = self._get_container(sandbox_id)

        def _run() -> CommandResult:
            exit_code, (stdout_b, stderr_b) = container.exec_run(
                ["bash", "-c", cmd],
                workdir=WORKSPACE_DIR,
                demux=True,  # separate stdout from stderr
            )
            return CommandResult(
                stdout=(stdout_b or b"").decode(errors="replace"),
                stderr=(stderr_b or b"").decode(errors="replace"),
                exit_code=exit_code if exit_code is not None else 0,
            )

        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_run), timeout=float(timeout)
            )
        except asyncio.TimeoutError:
            return CommandResult(stdout="", stderr=f"Command timed out after {timeout}s", exit_code=124)
        except Exception as exc:
            return CommandResult(stdout="", stderr=str(exc), exit_code=1)

    async def destroy(self, sandbox_id: str) -> None:
        container = self._containers.pop(sandbox_id, None)
        if container is None:
            return

        def _destroy() -> None:
            try:
                container.stop(timeout=5)
            except Exception:
                pass
            try:
                container.remove(force=True)
            except Exception:
                pass

        await asyncio.to_thread(_destroy)
        logger.info("docker sandbox destroyed: %s", sandbox_id[:12])


# ── Registry ──────────────────────────────────────────────────────────────────
# One singleton provider is shared across all requests.

_provider: SandboxProvider | None = None


def get_provider() -> SandboxProvider:
    """Return the singleton SandboxProvider, creating it on first call."""
    global _provider
    if _provider is None:
        _provider = _build_provider()
    return _provider


def _build_provider() -> SandboxProvider:
    from app.config import settings

    name = settings.sandbox_provider.lower()

    if name == "e2b":
        if not settings.e2b_api_key:
            raise RuntimeError(
                "SANDBOX_PROVIDER=e2b but E2B_API_KEY is not set. "
                "Either set E2B_API_KEY or use SANDBOX_PROVIDER=docker."
            )
        logger.info("sandbox provider: E2B (cloud)")
        return E2BSandboxProvider(api_key=settings.e2b_api_key)

    if name == "docker":
        logger.info("sandbox provider: Docker (local)")
        return DockerSandboxProvider()

    raise ValueError(
        f"Unknown SANDBOX_PROVIDER={name!r}. Valid values: 'e2b', 'docker'."
    )
