"""SQLAlchemy ORM models matching the schema spec."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, String, Text, func
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> str:
    return str(uuid.uuid4())


# ── Users ─────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String, nullable=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    github_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    github_token: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Settings stored as JSON blob
    settings: Mapped[dict] = mapped_column(JSONB, server_default="{}")

    memberships: Mapped[list["RoomMember"]] = relationship(back_populates="user")


# ── Rooms ─────────────────────────────────────────────────────────────────────

class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(6), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    brief: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[list] = mapped_column(JSONB, server_default="[]")
    max_teammates: Mapped[int] = mapped_column(Integer, default=4)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="waiting"
    )  # waiting | decomposing | coding | merging | complete
    lead_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    members: Mapped[list["RoomMember"]] = relationship(back_populates="room", lazy="selectin")
    tasks: Mapped[list["Task"]] = relationship(back_populates="room", lazy="selectin")
    merges: Mapped[list["Merge"]] = relationship(back_populates="room")


# ── Room members ──────────────────────────────────────────────────────────────

class RoomMember(Base):
    __tablename__ = "room_members"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    room_id: Mapped[str] = mapped_column(String, ForeignKey("rooms.id"), nullable=False)
    user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id"), nullable=True
    )
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, default="member")  # lead | member
    task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("tasks.id", use_alter=True, name="fk_room_members_task_id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String, default="waiting")
    # waiting | coding | blocked | done
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    room: Mapped["Room"] = relationship(back_populates="members")
    user: Mapped["User | None"] = relationship(back_populates="memberships")


# ── Tasks ─────────────────────────────────────────────────────────────────────

class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    room_id: Mapped[str] = mapped_column(String, ForeignKey("rooms.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    tech: Mapped[str] = mapped_column(String, default="")
    complexity: Mapped[str] = mapped_column(String, default="Medium")
    color: Mapped[str] = mapped_column(String, default="#4F8EF7")
    files: Mapped[list] = mapped_column(JSONB, server_default="[]")
    exposes: Mapped[list] = mapped_column(JSONB, server_default="[]")
    depends_on: Mapped[list] = mapped_column(JSONB, server_default="[]")
    contracts: Mapped[list] = mapped_column(JSONB, server_default="[]")
    contract_version: Mapped[int] = mapped_column(Integer, default=1)
    # Each entry: { version, contracts, changed_by, changed_at, reason }
    contract_history: Mapped[list] = mapped_column(JSONB, server_default="[]")
    assigned_to: Mapped[str | None] = mapped_column(
        String, ForeignKey("room_members.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String, default="unassigned")
    # unassigned | in_progress | done
    code: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    room: Mapped["Room"] = relationship(back_populates="tasks")


# ── Merges ────────────────────────────────────────────────────────────────────

class Merge(Base):
    __tablename__ = "merges"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    room_id: Mapped[str] = mapped_column(String, ForeignKey("rooms.id"), nullable=False)
    merged_files: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    diff_report: Mapped[list] = mapped_column(JSONB, server_default="[]")
    conflicts: Mapped[list] = mapped_column(JSONB, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    room: Mapped["Room"] = relationship(back_populates="merges")
