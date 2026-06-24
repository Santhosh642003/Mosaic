"""Pydantic models for all structured LLM outputs (Guard 1)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ── Decomposition schemas ──────────────────────────────────────────────────────

class ExposedInterface(BaseModel):
    name: str
    type: str
    description: str = ""


class DependencyRef(BaseModel):
    name: str
    provided_by: str


class TaskItem(BaseModel):
    name: str
    description: str
    tech: str = ""
    complexity: Literal["low", "medium", "high"] = "medium"
    color: str = "#4F8EF7"
    files: list[str] = Field(default_factory=list)
    exposes: list[ExposedInterface] = Field(default_factory=list)
    depends_on: list[DependencyRef] = Field(default_factory=list)


class TaskDecomposition(BaseModel):
    tasks: list[TaskItem]


# ── Merge schemas ──────────────────────────────────────────────────────────────

class DiffEntry(BaseModel):
    path: str
    operation: str  # added | modified | removed
    lines_added: int = 0
    lines_removed: int = 0


class ConflictEntry(BaseModel):
    id: str
    description: str
    resolution: str
    files: list[str] = Field(default_factory=list)


class MergeResult(BaseModel):
    merged_files: dict[str, str] = Field(default_factory=dict)
    diff_report: list[DiffEntry] = Field(default_factory=list)
    conflicts: list[ConflictEntry] = Field(default_factory=list)
