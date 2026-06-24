"""Add contract_version and contract_history to tasks.

Revision ID: 002
Revises: 001
Create Date: 2024-01-02 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "contract_version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )
    op.add_column(
        "tasks",
        sa.Column(
            "contract_history",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )
    # Also fix contracts column type from {} default to [] to match list semantics
    op.alter_column(
        "tasks",
        "contracts",
        server_default="[]",
    )


def downgrade() -> None:
    op.drop_column("tasks", "contract_history")
    op.drop_column("tasks", "contract_version")
