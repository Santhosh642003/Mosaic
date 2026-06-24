"""Initial schema: users, rooms, room_members, tasks, merges.

Revision ID: 001
Revises:
Create Date: 2024-01-01 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=True),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("github_id", sa.String(), nullable=True),
        sa.Column("avatar", sa.String(), nullable=True),
        sa.Column("settings", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("github_id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "rooms",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("code", sa.String(6), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("brief", sa.Text(), nullable=False),
        sa.Column("language", postgresql.JSONB(), nullable=True),
        sa.Column("max_teammates", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("status", sa.String(), nullable=False, server_default="waiting"),
        sa.Column("lead_id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["lead_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_rooms_code", "rooms", ["code"], unique=True)

    op.create_table(
        "room_members",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("room_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="member"),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="waiting"),
        sa.Column("is_guest", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_room_members_room_id", "room_members", ["room_id"])
    op.create_index("ix_room_members_user_id", "room_members", ["user_id"])

    op.create_table(
        "tasks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("room_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("tech", sa.String(), nullable=False, server_default=""),
        sa.Column("complexity", sa.String(), nullable=False, server_default="medium"),
        sa.Column("color", sa.String(), nullable=False, server_default="#4F8EF7"),
        sa.Column("files", postgresql.JSONB(), nullable=True),
        sa.Column("exposes", postgresql.JSONB(), nullable=True),
        sa.Column("depends_on", postgresql.JSONB(), nullable=True),
        sa.Column("contracts", postgresql.JSONB(), nullable=True),
        sa.Column("assigned_to", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("code", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(["assigned_to"], ["room_members.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_room_id", "tasks", ["room_id"])

    op.create_table(
        "merges",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("room_id", sa.String(), nullable=False),
        sa.Column("merged_files", postgresql.JSONB(), nullable=True),
        sa.Column("diff_report", postgresql.JSONB(), nullable=True),
        sa.Column("conflicts", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_merges_room_id", "merges", ["room_id"])

    # Deferred FK: room_members.task_id → tasks.id (circular, added after tasks exists)
    op.create_foreign_key(
        "fk_room_members_task_id",
        "room_members", "tasks",
        ["task_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_table("merges")
    op.drop_table("tasks")
    op.drop_table("room_members")
    op.drop_table("rooms")
    op.drop_table("users")
