"""Add Instagram channel state, events, and automation.

Revision ID: 20260820_instagram
Revises:
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260820_instagram"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "instagram_auth_states" not in tables:
        op.create_table(
            "instagram_auth_states",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36), sa.ForeignKey("channel_accounts.id"), nullable=False),
            sa.Column("settings_enc", sa.Text(), nullable=False, server_default=""),
            sa.Column("credentials_enc", sa.Text(), nullable=False, server_default=""),
            sa.Column("pending_enc", sa.Text(), nullable=False, server_default=""),
            sa.Column("profile_json", sa.Text(), nullable=False, server_default=""),
            sa.Column("cursors_json", sa.Text(), nullable=False, server_default=""),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("account_id"),
        )
        op.create_index("ix_instagram_auth_states_account_id", "instagram_auth_states", ["account_id"], unique=True)

    if "instagram_events" not in tables:
        op.create_table(
            "instagram_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("account_id", sa.String(36), sa.ForeignKey("channel_accounts.id"), nullable=False),
            sa.Column("lead_id", sa.String(36), sa.ForeignKey("leads.id"), nullable=True),
            sa.Column("message_id", sa.String(36), sa.ForeignKey("messages.id"), nullable=True),
            sa.Column("event_type", sa.String(24), nullable=False),
            sa.Column("external_event_id", sa.String(160), nullable=False),
            sa.Column("external_thread_id", sa.String(160), nullable=False, server_default=""),
            sa.Column("external_media_id", sa.String(160), nullable=False, server_default=""),
            sa.Column("external_author_id", sa.String(160), nullable=False, server_default=""),
            sa.Column("parent_comment_id", sa.String(160), nullable=False, server_default=""),
            sa.Column("body", sa.Text(), nullable=False, server_default=""),
            sa.Column("author_json", sa.JSON(), nullable=False),
            sa.Column("occurred_at", sa.DateTime(), nullable=True),
            sa.Column("status", sa.String(24), nullable=False, server_default="received"),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("account_id", "event_type", "external_event_id", name="uq_instagram_event_external"),
        )
        for column in ("org_id", "account_id", "event_type", "external_event_id", "external_thread_id", "external_media_id", "external_author_id", "status", "created_at"):
            op.create_index(f"ix_instagram_events_{column}", "instagram_events", [column])

    if "automation_rules" not in tables:
        op.create_table(
            "automation_rules",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("name", sa.String(160), nullable=False, server_default=""),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("trigger_type", sa.String(48), nullable=False),
            sa.Column("source_channel", sa.String(40), nullable=False, server_default=""),
            sa.Column("source_account_id", sa.String(36), sa.ForeignKey("channel_accounts.id"), nullable=True),
            sa.Column("conditions", sa.JSON(), nullable=False),
            sa.Column("actions", sa.JSON(), nullable=False),
            sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_automation_rules_org_id", "automation_rules", ["org_id"])
        op.create_index("ix_automation_rules_enabled", "automation_rules", ["enabled"])
        op.create_index("ix_automation_rules_trigger_type", "automation_rules", ["trigger_type"])

    if "automation_runs" not in tables:
        op.create_table(
            "automation_runs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("rule_id", sa.String(36), sa.ForeignKey("automation_rules.id"), nullable=False),
            sa.Column("event_id", sa.String(36), sa.ForeignKey("instagram_events.id"), nullable=False),
            sa.Column("status", sa.String(24), nullable=False, server_default="queued"),
            sa.Column("result", sa.JSON(), nullable=False),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("org_id", "rule_id", "event_id", name="uq_automation_run_event"),
        )
        op.create_index("ix_automation_runs_org_id", "automation_runs", ["org_id"])
        op.create_index("ix_automation_runs_rule_id", "automation_runs", ["rule_id"])
        op.create_index("ix_automation_runs_event_id", "automation_runs", ["event_id"])
        op.create_index("ix_automation_runs_status", "automation_runs", ["status"])


def downgrade() -> None:
    op.drop_table("automation_runs")
    op.drop_table("automation_rules")
    op.drop_table("instagram_events")
    op.drop_table("instagram_auth_states")
