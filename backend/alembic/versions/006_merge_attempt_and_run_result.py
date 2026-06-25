"""Add attempt and run_result columns to merges table.

Revision ID: 006
Revises: 005
Create Date: 2026-06-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("merges", sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("merges", sa.Column("run_result", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("merges", "run_result")
    op.drop_column("merges", "attempt")
