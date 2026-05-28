"""baseline current sqlite schema

Revision ID: 20260526_0001
Revises:
Create Date: 2026-05-26
"""

from alembic import op


revision = "20260526_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The current prototype schema is created by backend.app.database.init_db.
    # This baseline lets production migration history start from the current shape
    # before the Postgres cutover replaces raw SQLite DDL with Alembic migrations.
    op.execute("SELECT 1")


def downgrade() -> None:
    op.execute("SELECT 1")

