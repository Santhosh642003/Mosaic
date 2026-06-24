"""Add room_members.skills and tasks.suggested_assignee.

Guests (and the lead) describe what they're good at as free text. Those
skills are fed into the AI decomposer, which suggests which member best
fits each task. The suggestion is stored on the task as a member name.

Revision ID: 005
Revises: 004
Create Date: 2026-06-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("room_members", sa.Column("skills", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("suggested_assignee", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "suggested_assignee")
    op.drop_column("room_members", "skills")
