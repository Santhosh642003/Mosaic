"""Pydantic schemas for request/response validation."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, computed_field, field_validator


def _initials(name: str) -> str:
    parts = name.strip().split()
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


_AVATAR_PALETTE = [
    "#4F8EF7", "#A371F7", "#3FB950", "#D29922",
    "#F78166", "#58A6FF", "#56D364", "#E3B341",
]


def _avatar_color(name: str) -> str:
    h = sum(ord(c) for c in name)
    return _AVATAR_PALETTE[h % len(_AVATAR_PALETTE)]


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
    has_github_token: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_user(cls, user: "User") -> "UserResponse":  # type: ignore[name-defined]
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            avatar=user.avatar,
            github_id=user.github_id,
            has_github_token=bool(user.github_token),
            created_at=user.created_at,
        )


# ── Room ─────────────────────────────────────────────────────────────────────

class CreateRoomRequest(BaseModel):
    name: str
    brief: str
    language: list[str] = []
    max_teammates: int = 4
    skills: str | None = None  # the lead's own skills


class JoinRoomRequest(BaseModel):
    display_name: str | None = None
    skills: str | None = None


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
    skills: str | None = None
    is_guest: bool

    model_config = {"from_attributes": True}

    @computed_field  # type: ignore[misc]
    @property
    def initials(self) -> str:
        return _initials(self.display_name)

    @computed_field  # type: ignore[misc]
    @property
    def avatar_color(self) -> str:
        return _avatar_color(self.display_name)


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
    contracts: list[dict[str, Any]] = []
    contract_version: int = 1
    assigned_to: str | None
    suggested_assignee: str | None = None
    status: str
    code: dict[str, str]

    model_config = {"from_attributes": True}


class SubmitTaskRequest(BaseModel):
    code: dict[str, str]


class AssignTaskRequest(BaseModel):
    # Guests have no JWT, so the client identifies them by their member id.
    member_id: str | None = None


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
    attempt: int | None = None
    run_result: dict[str, Any] | None = None


# ── GitHub push ───────────────────────────────────────────────────────────────

class GitHubPushRequest(BaseModel):
    repo: str  # "owner/repo" or just "repo" (auto-prefixes authenticated user)
    branch: str = "mosaic-merge"
    commit_message: str = "feat: Mosaic merged codebase"


class GitHubPushResponse(BaseModel):
    repo: str
    branch: str
    url: str
    files_pushed: int


# ── User update ───────────────────────────────────────────────────────────────

class UpdateProfileRequest(BaseModel):
    display_name: str | None = None
    avatar: str | None = None
    settings: dict[str, Any] | None = None
