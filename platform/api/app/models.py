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


class ChannelType(str, enum.Enum):
    whatsapp = "whatsapp"
    divar = "divar"


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    organization = relationship("Organization", back_populates="channel_accounts")

    @property
    def phone(self) -> str:
        """Backward-compatible alias used by WA clients. """
        return self.external_id if self.channel == ChannelType.whatsapp else ""


# Backward-compatible alias
WhatsAppAccount = ChannelAccount


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


class ExtensionSeat(Base):
    """One concurrent Chrome-extension connection seat for an organization.

    token_plain is kept so owners can always copy the token from the dashboard.
    token_hash is used for lookups. After first activate, the seat locks to that
    install_id until admin resets/removes it.
    """

    __tablename__ = "extension_seats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    label: Mapped[str] = mapped_column(String(120), default="")
    token_prefix: Mapped[str] = mapped_column(String(16), default="")
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    token_plain: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(40), default="available")  # available|locked|revoked
    bound_install_id: Mapped[str] = mapped_column(String(80), default="")
    bound_device_id: Mapped[str] = mapped_column(String(80), default="")
    bound_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(32), default="", index=True)
    group_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    external_chat_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    post_token: Mapped[str] = mapped_column(String(120), default="")
    source_channel: Mapped[str] = mapped_column(String(40), default="")
    chat_type: Mapped[str] = mapped_column(String(20), default="pv")
    stage: Mapped[str] = mapped_column(String(40), default="جدید", index=True)
    board_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
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
    allowed_stages: Mapped[list] = mapped_column(JSON, default=lambda: ["جدید"])
    business_hours_only: Mapped[bool] = mapped_column(Boolean, default=False)
    hours_start: Mapped[str] = mapped_column(String(8), default="09:00")
    hours_end: Mapped[str] = mapped_column(String(8), default="18:00")
    agent_role: Mapped[str] = mapped_column(String(200), default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    # Empty = inherit platform ai_defaults.fallback_message
    fallback_message: Mapped[str] = mapped_column(Text, default="")


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
