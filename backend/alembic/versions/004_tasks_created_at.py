"""Add created_at to tasks table.

The Task model declares a created_at column, but it was never added in the
initial schema (001) or the contract-versioning migration (002), so any query
that loads tasks fails with UndefinedColumnError. This backfills it.

Revision ID: 004
Revises: 003
Create Date: 2026-06-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("tasks", "created_at")
