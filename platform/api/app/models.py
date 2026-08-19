from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def uid() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.utcnow()


class MemberRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    agent = "agent"
    viewer = "viewer"


class ConnectorRole(str, enum.Enum):
    connector = "connector"
    agent = "agent"
    baileys = "baileys"
    divar = "divar"
    bale = "bale"
    instagram = "instagram"


class ChannelType(str, enum.Enum):
    whatsapp = "whatsapp"
    divar = "divar"
    bale = "bale"
    instagram = "instagram"


class TaskStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    done = "done"
    cancelled = "cancelled"


class MessageDirection(str, enum.Enum):
    inbound = "inbound"
    outbound = "outbound"


class SenderType(str, enum.Enum):
    customer = "customer"
    agent = "agent"
    ai = "ai"
    system = "system"


class OutboundStatus(str, enum.Enum):
    queued = "queued"
    claimed = "claimed"
    sent = "sent"
    failed = "failed"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    plan: Mapped[str] = mapped_column(String(40), default="starter")
    status: Mapped[str] = mapped_column(String(40), default="active")  # active | suspended
    # profile → plan → payment → guides → done
    onboarding_step: Mapped[str] = mapped_column(String(40), default="done")
    industry: Mapped[str] = mapped_column(String(120), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    plan_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    memberships = relationship("Membership", back_populates="organization")
    channel_accounts = relationship("ChannelAccount", back_populates="organization")
    payments = relationship("Payment", back_populates="organization")


class Payment(Base):
    """Gateway payment (mock or Zibal) for onboarding / renew / upgrade."""

    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    purpose: Mapped[str] = mapped_column(String(40), default="onboarding")  # onboarding|renew|upgrade
    plan: Mapped[str] = mapped_column(String(40), default="starter")
    amount_irr: Mapped[int] = mapped_column(Integer, default=0)
    provider: Mapped[str] = mapped_column(String(40), default="mock")  # mock|zibal
    track_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    ref_number: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(40), default="pending")  # pending|paid|failed
    raw_request: Mapped[str] = mapped_column(Text, default="")
    raw_callback: Mapped[str] = mapped_column(Text, default="")
    raw_verify: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    organization = relationship("Organization", back_populates="payments")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    phone: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    memberships = relationship("Membership", back_populates="user")


class PlatformSetting(Base):
    """Key/value store for platform-wide (super-admin) settings."""

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class PricingPlan(Base):
    """Editable subscription plans (super-admin managed)."""

    __tablename__ = "pricing_plans"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # slug: starter, growth, …
    label: Mapped[str] = mapped_column(String(120), default="")
    price_irr: Mapped[int] = mapped_column(Integer, default=0)
    price_label: Mapped[str] = mapped_column(String(200), default="")
    max_seats: Mapped[int] = mapped_column(Integer, default=1)
    max_channel_accounts: Mapped[int] = mapped_column(Integer, default=9999)
    ai_suggest: Mapped[bool] = mapped_column(Boolean, default=True)
    ai_auto_send: Mapped[bool] = mapped_column(Boolean, default=False)
    message_retention_days: Mapped[int] = mapped_column(Integer, default=30)
    features: Mapped[list] = mapped_column(JSON, default=list)  # marketing / allowed items
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class SmsTemplate(Base):
    """sms.ir verify templates managed in super-admin panel."""

    __tablename__ = "sms_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120), default="")
    template_id: Mapped[int] = mapped_column(Integer, default=0)  # sms.ir TemplateId
    # [{"name":"Code","source":"otp"}, {"name":"Brand","source":"static","value":"..."}]
    parameters: Mapped[list] = mapped_column(JSON, default=list)
    purpose: Mapped[str] = mapped_column(String(40), default="otp")  # otp | custom
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)  # default OTP template
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_membership"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[MemberRole] = mapped_column(Enum(MemberRole), default=MemberRole.agent)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    organization = relationship("Organization", back_populates="memberships")
    user = relationship("User", back_populates="memberships")


class OtpChallenge(Base):
    __tablename__ = "otp_challenges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    phone: Mapped[str] = mapped_column(String(32), index=True)
    code: Mapped[str] = mapped_column(String(12))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ChannelAccount(Base):
    __tablename__ = "channel_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    channel: Mapped[ChannelType] = mapped_column(
        Enum(ChannelType), default=ChannelType.whatsapp, index=True
    )
    label: Mapped[str] = mapped_column(String(120), default="")
    # WA phone or Divar session label / external id
    external_id: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(40), default="disconnected")
    # baileys = WA server; divar_api = Divar HTTP client; bale_api = Bale WS client
    connector_type: Mapped[str] = mapped_column(String(40), default="baileys")
    # disconnected | qr_pending | otp_pending | connected | reconnecting | auth_required
    pairing_state: Mapped[str] = mapped_column(String(40), default="disconnected")
    wa_jid: Mapped[str] = mapped_column(String(120), default="")
    # Short-lived QR payload (data URL / base64) for panel pairing
    qr_payload: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    organization = relationship("Organization", back_populates="channel_accounts")

    @property
    def phone(self) -> str:
        """Backward-compatible alias used by WA clients. """
        return self.external_id if self.channel == ChannelType.whatsapp else ""


# Backward-compatible alias
WhatsAppAccount = ChannelAccount


class WaAuthState(Base):
    """Encrypted Baileys auth state per channel account."""

    __tablename__ = "wa_auth_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("channel_accounts.id"), unique=True, index=True
    )
    creds_enc: Mapped[str] = mapped_column(Text, default="")
    keys_enc: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class DivarAuthState(Base):
    """Encrypted Divar cookie session + OTP pending + sync cursors."""

    __tablename__ = "divar_auth_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("channel_accounts.id"), unique=True, index=True
    )
    cookies_enc: Mapped[str] = mapped_column(Text, default="")
    pending_enc: Mapped[str] = mapped_column(Text, default="")
    cursors_json: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class BaleAuthState(Base):
    """Encrypted Bale access token + OTP pending + sync cursors."""

    __tablename__ = "bale_auth_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("channel_accounts.id"), unique=True, index=True
    )
    token_enc: Mapped[str] = mapped_column(Text, default="")
    pending_enc: Mapped[str] = mapped_column(Text, default="")
    cursors_json: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class InstagramAuthState(Base):
    """Encrypted instagrapi settings and pending authentication state."""

    __tablename__ = "instagram_auth_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("channel_accounts.id"), unique=True, index=True
    )
    settings_enc: Mapped[str] = mapped_column(Text, default="")
    credentials_enc: Mapped[str] = mapped_column(Text, default="")
    pending_enc: Mapped[str] = mapped_column(Text, default="")
    profile_json: Mapped[str] = mapped_column(Text, default="")
    cursors_json: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class InstagramEvent(Base):
    """Normalized Instagram DM/comment event used for idempotent processing."""

    __tablename__ = "instagram_events"
    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "event_type",
            "external_event_id",
            name="uq_instagram_event_external",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("channel_accounts.id"), index=True)
    lead_id: Mapped[str | None] = mapped_column(ForeignKey("leads.id"), nullable=True, index=True)
    message_id: Mapped[str | None] = mapped_column(ForeignKey("messages.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(24), index=True)  # dm | comment | comment_reply
    external_event_id: Mapped[str] = mapped_column(String(160), index=True)
    external_thread_id: Mapped[str] = mapped_column(String(160), default="", index=True)
    external_media_id: Mapped[str] = mapped_column(String(160), default="", index=True)
    external_author_id: Mapped[str] = mapped_column(String(160), default="", index=True)
    parent_comment_id: Mapped[str] = mapped_column(String(160), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    author_json: Mapped[dict] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="received", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class AutomationRule(Base):
    """Organization-scoped trigger/condition/action definition."""

    __tablename__ = "automation_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(160), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=0, index=True)
    trigger_type: Mapped[str] = mapped_column(String(48), index=True)
    source_channel: Mapped[str] = mapped_column(String(40), default="")
    source_account_id: Mapped[str | None] = mapped_column(
        ForeignKey("channel_accounts.id"), nullable=True, index=True
    )
    conditions: Mapped[list] = mapped_column(JSON, default=list)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class AutomationRun(Base):
    """Idempotent audit record for a rule execution against an external event."""

    __tablename__ = "automation_runs"
    __table_args__ = (
        UniqueConstraint("org_id", "rule_id", "event_id", name="uq_automation_run_event"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    rule_id: Mapped[str] = mapped_column(ForeignKey("automation_rules.id"), index=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("instagram_events.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class ConnectorSession(Base):
    __tablename__ = "connector_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("channel_accounts.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    device_id: Mapped[str] = mapped_column(String(80), index=True)
    role: Mapped[ConnectorRole] = mapped_column(Enum(ConnectorRole), default=ConnectorRole.agent)
    status: Mapped[str] = mapped_column(String(40), default="online")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(32), default="", index=True)
    group_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    external_chat_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    # WhatsApp Linked ID (…@lid) — kept even when external_chat_id is upgraded to PN
    wa_lid: Mapped[str] = mapped_column(String(120), default="", index=True)
    post_token: Mapped[str] = mapped_column(String(120), default="")
    source_channel: Mapped[str] = mapped_column(String(40), default="")
    chat_type: Mapped[str] = mapped_column(String(20), default="pv")
    stage: Mapped[str] = mapped_column(String(40), default="جدید", index=True)
    board_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    lead_score: Mapped[float] = mapped_column(Float, default=0.0)
    # {sentiment, suggested_stage, last_enriched_at, last_message_id, confidence, escalation}
    ai_meta: Mapped[dict] = mapped_column(JSON, default=dict)
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    bot_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class LeadAccountLink(Base):
    __tablename__ = "lead_account_links"
    __table_args__ = (
        UniqueConstraint("org_id", "account_id", "chat_name", name="uq_lead_account_chat"),
        UniqueConstraint("org_id", "account_id", "external_chat_id", name="uq_lead_account_ext"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("channel_accounts.id"), index=True)
    chat_name: Mapped[str] = mapped_column(String(200), default="")
    external_chat_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("channel_accounts.id"), index=True)
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id"), index=True)
    direction: Mapped[MessageDirection] = mapped_column(Enum(MessageDirection))
    sender_type: Mapped[SenderType] = mapped_column(Enum(SenderType), default=SenderType.customer)
    body: Mapped[str] = mapped_column(Text, default="")
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Stores WA message id or Divar/external message id
    wa_message_id: Mapped[str] = mapped_column(String(120), default="")
    media_type: Mapped[str] = mapped_column(String(40), default="")  # text|image|audio|document|video
    media_url: Mapped[str] = mapped_column(Text, default="")
    # pending | sent | delivered | read | played (WhatsApp ack ladder)
    delivery_status: Mapped[str] = mapped_column(String(20), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    lead_id: Mapped[str | None] = mapped_column(ForeignKey("leads.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus), default=TaskStatus.open)
    board_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | ai | system
    source_message_id: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class OutboundJob(Base):
    __tablename__ = "outbound_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("channel_accounts.id"), index=True)
    lead_id: Mapped[str | None] = mapped_column(ForeignKey("leads.id"), nullable=True)
    target_name: Mapped[str] = mapped_column(String(200), default="")
    # Primary WhatsApp JID for Baileys send (e.g. 972…@s.whatsapp.net or …@g.us)
    target_jid: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    sender_type: Mapped[SenderType] = mapped_column(Enum(SenderType), default=SenderType.agent)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[OutboundStatus] = mapped_column(Enum(OutboundStatus), default=OutboundStatus.queued)
    claimed_by_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class KnowledgeDoc(Base):
    __tablename__ = "knowledge_docs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    source: Mapped[str] = mapped_column(String(200), default="upload")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    doc_id: Mapped[str] = mapped_column(ForeignKey("knowledge_docs.id"), index=True)
    content: Mapped[str] = mapped_column(Text, default="")
    embedding: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AiPolicy(Base):
    __tablename__ = "ai_policies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), unique=True)
    auto_send_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Legacy boolean — kept in sync with group_reply_mode for older clients
    group_auto_send_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # off | keywords  (default off = save group messages, never AI-reply)
    group_reply_mode: Mapped[str] = mapped_column(String(32), default="off")
    group_keywords: Mapped[list] = mapped_column(JSON, default=list)
    min_confidence: Mapped[float] = mapped_column(Float, default=0.45)
    allowed_stages: Mapped[list] = mapped_column(
        JSON, default=lambda: ["جدید", "پیگیری", "پیشنهاد"]
    )
    business_hours_only: Mapped[bool] = mapped_column(Boolean, default=False)
    hours_start: Mapped[str] = mapped_column(String(8), default="09:00")
    hours_end: Mapped[str] = mapped_column(String(8), default="18:00")
    agent_role: Mapped[str] = mapped_column(String(200), default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    # Empty = inherit platform ai_defaults.fallback_message
    fallback_message: Mapped[str] = mapped_column(Text, default="")
    auto_apply_stage: Mapped[bool] = mapped_column(Boolean, default=False)
    pause_bot_on_escalate: Mapped[bool] = mapped_column(Boolean, default=True)


class OrgCoachProfile(Base):
    """Per-org «پیر خرابات» business profile from the onboarding wizard."""

    __tablename__ = "org_coach_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), unique=True, index=True)
    niche: Mapped[str] = mapped_column(String(120), default="")
    audience: Mapped[str] = mapped_column(Text, default="")
    tone: Mapped[str] = mapped_column(String(40), default="")
    goals: Mapped[list] = mapped_column(JSON, default=list)
    offers: Mapped[str] = mapped_column(Text, default="")
    banned_phrases: Mapped[str] = mapped_column(Text, default="")
    wizard_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class CoachMessage(Base):
    """Internal coach chat thread (team ↔ پیر خرابات), never sent to WhatsApp."""

    __tablename__ = "coach_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="user")  # user | assistant
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class KpiDefinition(Base):
    __tablename__ = "kpi_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    key: Mapped[str] = mapped_column(String(80))
    label: Mapped[str] = mapped_column(String(160))
    target_value: Mapped[float] = mapped_column(Float, default=0)
    unit: Mapped[str] = mapped_column(String(40), default="")


class KpiSnapshot(Base):
    __tablename__ = "kpi_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    key: Mapped[str] = mapped_column(String(80), index=True)
    value: Mapped[float] = mapped_column(Float, default=0)
    period: Mapped[str] = mapped_column(String(40), default="weekly")
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class OkrObjective(Base):
    __tablename__ = "okr_objectives"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    target_value: Mapped[float] = mapped_column(Float, default=0)
    current_value: Mapped[float] = mapped_column(Float, default=0)
    period: Mapped[str] = mapped_column(String(40), default="quarter")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    message: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class SupportTicket(Base):
    """Business ↔ platform support ticket."""

    __tablename__ = "support_tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    subject: Mapped[str] = mapped_column(String(240), default="")
    category: Mapped[str] = mapped_column(String(60), default="general")  # general|billing|technical|ai
    status: Mapped[str] = mapped_column(String(40), default="open", index=True)  # open|in_progress|resolved|closed
    priority: Mapped[str] = mapped_column(String(20), default="normal")  # low|normal|high
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    messages = relationship(
        "SupportMessage",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="SupportMessage.created_at",
    )


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("support_tickets.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    sender_side: Mapped[str] = mapped_column(String(20), default="business")  # business|platform
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    ticket = relationship("SupportTicket", back_populates="messages")


class AiEvent(Base):
    """Thin event log for AI CRM KPIs (enrich / suggest / skip / escalate)."""

    __tablename__ = "ai_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    lead_id: Mapped[str | None] = mapped_column(ForeignKey("leads.id"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Campaign(Base):
    """One-shot segment nurture blast via existing outbound pipeline."""

    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    # {tags: [], stages: [], min_score: 0, include_groups: false}
    segment_json: Mapped[dict] = mapped_column(JSON, default=dict)
    message_template: Mapped[str] = mapped_column(Text, default="")
    channel_account_id: Mapped[str | None] = mapped_column(
        ForeignKey("channel_accounts.id"), nullable=True
    )
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CampaignSend(Base):
    __tablename__ = "campaign_sends"
    __table_args__ = (
        UniqueConstraint("campaign_id", "lead_id", name="uq_campaign_lead"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id"), index=True)
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    job_id: Mapped[str] = mapped_column(String(36), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
