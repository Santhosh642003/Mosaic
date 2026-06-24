"""Pydantic schemas for request/response validation."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, field_validator


# ── Auth ─────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    avatar: str | None
    github_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Room ─────────────────────────────────────────────────────────────────────

class CreateRoomRequest(BaseModel):
    name: str
    brief: str
    language: list[str] = []
    max_teammates: int = 4


class JoinRoomRequest(BaseModel):
    display_name: str | None = None


class RoomResponse(BaseModel):
    id: str
    code: str
    name: str
    brief: str
    language: list[str]
    max_teammates: int
    status: str
    lead_id: str
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class MemberResponse(BaseModel):
    id: str
    room_id: str
    user_id: str | None
    display_name: str
    role: str
    task_id: str | None
    status: str
    is_guest: bool

    model_config = {"from_attributes": True}


class RoomStateResponse(BaseModel):
    room: RoomResponse
    members: list[MemberResponse]
    tasks: list["TaskResponse"]


# ── Task ─────────────────────────────────────────────────────────────────────

class ContractSchema(BaseModel):
    signature: str
    description: str | None = None
    task_id: str | None = None


class TaskResponse(BaseModel):
    id: str
    room_id: str
    name: str
    description: str
    tech: str
    complexity: str
    color: str
    files: list[str]
    exposes: list[dict[str, Any]]
    depends_on: list[dict[str, Any]]
    assigned_to: str | None
    status: str
    code: dict[str, str]

    model_config = {"from_attributes": True}


class SubmitTaskRequest(BaseModel):
    code: dict[str, str]


# ── Merge ─────────────────────────────────────────────────────────────────────

class DiffEntrySchema(BaseModel):
    path: str
    operation: str  # added | modified | removed
    diff: str | None = None
    lines_added: int | None = None
    lines_removed: int | None = None


class ConflictSchema(BaseModel):
    id: str
    description: str
    resolution: str
    files: list[str]


class MergeResponse(BaseModel):
    room_id: str
    status: str
    merged_files: dict[str, Any] = {}
    diff_report: list[dict[str, Any]] | None = None
    conflicts: list[dict[str, Any]] | None = None


# ── User update ───────────────────────────────────────────────────────────────

class UpdateProfileRequest(BaseModel):
    display_name: str | None = None
    avatar: str | None = None
    settings: dict[str, Any] | None = None
