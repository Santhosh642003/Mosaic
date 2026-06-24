"""Mosaic FastAPI application entry point."""

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_redis, engine, Base
from app.routers import auth, rooms, tasks, users, merge as merge_router
from app.socket_manager import sio


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Create DB tables on startup (Alembic handles production migrations)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await close_redis()
    await engine.dispose()


# ── FastAPI app ────────────────────────────────────────────────────────────────

fastapi_app = FastAPI(
    title="Mosaic API",
    description="Collaborative AI coding platform for hackathon teams.",
    version="0.1.0",
    lifespan=lifespan,
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "http://localhost",
        "http://localhost:80",
        "http://localhost:5173",
        "http://127.0.0.1",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

fastapi_app.include_router(auth.router,         prefix="/api/auth",  tags=["auth"])
fastapi_app.include_router(rooms.router,        prefix="/api/rooms", tags=["rooms"])
fastapi_app.include_router(users.router,        prefix="/api/users", tags=["users"])
fastapi_app.include_router(tasks.router,        prefix="/api/rooms", tags=["tasks"])
fastapi_app.include_router(merge_router.router, prefix="/api/rooms", tags=["merge"])


@fastapi_app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": "mosaic-api"}


# ── Socket.io ASGI mount ──────────────────────────────────────────────────────

# Wrap FastAPI with the Socket.io ASGI app so both share the same process.
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="/socket.io")
