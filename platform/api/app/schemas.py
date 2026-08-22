from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class OtpRequestIn(BaseModel):
    phone: str


class OtpVerifyIn(BaseModel):
    phone: str
    code: str
    display_name: str = ""
    org_name: str = ""


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    org_id: str
    role: str
    is_new: bool = False
    onboarding_step: str = "done"


class TokenRefreshIn(BaseModel):
    refresh_token: str = Field(min_length=16)
    org_id: str = ""


class LogoutIn(BaseModel):
    refresh_token: str = Field(min_length=16)


class OrgOut(BaseModel):
    id: str
    name: str
    plan: str
    limits: dict[str, Any]
    onboarding_step: str = "done"
    industry: str = ""
    city: str = ""
    plan_expires_at: str | None = None
    days_remaining: int | None = None
    plan_label: str = ""


class OnboardingProfileIn(BaseModel):
    org_name: str = Field(min_length=2)
    display_name: str = ""
    industry: str = ""
    city: str = ""


class OnboardingPlanIn(BaseModel):
    plan: str


class OnboardingPayIn(BaseModel):
    plan: str = ""
    mock_card: str = "4242"


class OnboardingAiSettingsIn(BaseModel):
    agent_role: str
    auto_send_enabled: bool = True


class OnboardingKnowledgeIn(BaseModel):
    title: str
    content: str


class MemberOut(BaseModel):
    id: str
    user_id: str
    phone: str
    display_name: str
    role: str


class InviteIn(BaseModel):
    phone: str
    role: str = "agent"
    display_name: str = ""


class PlanUpdateIn(BaseModel):
    plan: str


class ChannelAccountIn(BaseModel):
    channel: str = "whatsapp"
    label: str = ""
    external_id: str = ""
    phone: str = ""  # WA alias for external_id
    connector_type: str = "baileys"  # baileys | divar_api | bale_api | instagram_api


class ChannelAccountOut(BaseModel):
    id: str
    channel: str
    label: str
    external_id: str
    phone: str  # WA alias
    status: str
    connector_type: str = "baileys"
    pairing_state: str = "disconnected"
    wa_jid: str = ""


class DivarPairStartIn(BaseModel):
    phone: str


class DivarPairCodeIn(BaseModel):
    code: str


class DivarPairStatusOut(BaseModel):
    account_id: str
    pairing_state: str
    status: str
    phone: str = ""
    connector_type: str = "divar_api"
    message: str = ""


class DivarAuthStateIn(BaseModel):
    cookies_json: str = ""
    pending_json: str = ""
    cursors_json: str = ""


class DivarAuthStateOut(BaseModel):
    account_id: str
    cookies_json: str = ""
    pending_json: str = ""
    cursors_json: str = ""


class BalePairStartIn(BaseModel):
    phone: str


class BalePairCodeIn(BaseModel):
    code: str


class BalePairStatusOut(BaseModel):
    account_id: str
    pairing_state: str
    status: str
    phone: str = ""
    display_name: str = ""
    user_id: str = ""
    connector_type: str = "bale_api"
    sent_code_type: int | None = None
    message: str = ""


class BaleAuthStateIn(BaseModel):
    token_json: str = ""
    pending_json: str = ""
    cursors_json: str = ""


class BaleAuthStateOut(BaseModel):
    account_id: str
    token_json: str = ""
    pending_json: str = ""
    cursors_json: str = ""


class InstagramPairStartIn(BaseModel):
    session_id: str = Field(min_length=20, max_length=512)


class InstagramPairStatusOut(BaseModel):
    account_id: str
    pairing_state: str
    status: str
    username: str = ""
    user_id: str = ""
    connector_type: str = "instagram_api"
    message: str = ""


class InstagramAuthStateIn(BaseModel):
    session_id: str = ""
    client_settings_json: str = ""
    cursors_json: str = ""


class InstagramAuthStateOut(BaseModel):
    account_id: str
    session_id: str = ""
    username: str = ""
    user_id: str = ""
    client_settings_json: str = ""
    cursors_json: str = ""


# Backward-compatible aliases
WhatsAppAccountIn = ChannelAccountIn
WhatsAppAccountOut = ChannelAccountOut


class WaPairStatusOut(BaseModel):
    account_id: str
    pairing_state: str
    status: str
    qr_payload: str = ""
    wa_jid: str = ""
    connector_type: str = "baileys"
    phone: str = ""


class WaPairCodeStartIn(BaseModel):
    """Start Baileys pairing-code flow (8-digit code on phone)."""

    phone: str


class WaAuthStateIn(BaseModel):
    creds_json: str = ""
    keys_json: str = ""


class WaAuthStateOut(BaseModel):
    account_id: str
    creds_json: str = ""
    keys_json: str = ""


class WaPairStateIn(BaseModel):
    pairing_state: str = "disconnected"
    qr_payload: str = ""
    wa_jid: str = ""
    status: str = ""
    external_id: str = ""


class WaGroupParticipantsOut(BaseModel):
    group_jid: str
    subject: str = ""
    participants: list[dict] = Field(default_factory=list)


class HeartbeatIn(BaseModel):
    account_id: str
    device_id: str
    role: str = "agent"


class LeadIn(BaseModel):
    name: str
    phone: str = ""
    group_id: str = ""
    external_chat_id: str = ""
    wa_lid: str = ""
    post_token: str = ""
    source_channel: str = ""
    chat_type: str = "pv"
    stage: str | None = None
    tags: list[str] = Field(default_factory=list)
    notes: str = ""
    assignee_id: str | None = None
    bot_paused: bool | None = None
    account_id: str | None = None
    chat_name: str = ""


class LeadOut(BaseModel):
    id: str
    name: str
    phone: str
    group_id: str
    external_chat_id: str | None = None
    wa_lid: str = ""
    post_token: str = ""
    source_channel: str = ""
    chat_type: str
    stage: str
    board_order: int = 0
    tags: list[str]
    notes: str
    lead_score: float = 0.0
    ai_meta: dict = Field(default_factory=dict)
    assignee_id: str | None
    bot_paused: bool
    last_message_at: datetime | None
    created_at: datetime
    updated_at: datetime


class LeadPatchIn(BaseModel):
    name: str | None = None
    phone: str | None = None
    group_id: str | None = None
    external_chat_id: str | None = None
    wa_lid: str | None = None
    post_token: str | None = None
    source_channel: str | None = None
    chat_type: str | None = None
    stage: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    lead_score: float | None = None
    assignee_id: str | None = None
    bot_paused: bool | None = None
    board_order: int | None = None


class LeadBoardOrderItem(BaseModel):
    id: str
    stage: str
    board_order: int


class LeadBoardReorderIn(BaseModel):
    updates: list[LeadBoardOrderItem]


class TaskIn(BaseModel):
    title: str = ""
    message: str = ""
    lead_id: str | None = None
    assignee_id: str | None = None
    due_at: datetime | None = None
    status: str | None = None
    source: str = "manual"
    source_message_id: str = ""
    conversation_excerpt: str = ""


class ContactTaskIn(BaseModel):
    title: str = ""
    message: str = ""
    assignee_id: str | None = None
    due_at: datetime | None = None
    status: str | None = None
    source: str = "manual"
    source_message_id: str = ""
    conversation_excerpt: str = ""


class TaskOut(BaseModel):
    id: str
    title: str
    message: str
    lead_id: str | None
    assignee_id: str | None
    created_by_id: str | None
    due_at: datetime | None
    status: str
    board_order: int = 0
    source: str = "manual"
    source_message_id: str = ""
    created_at: datetime


class TaskBoardOrderItem(BaseModel):
    id: str
    status: str
    board_order: int


class TaskBoardReorderIn(BaseModel):
    updates: list[TaskBoardOrderItem]


class MessageIngestIn(BaseModel):
    account_id: str
    chat_name: str
    body: str
    direction: str = "inbound"
    phone: str = ""
    group_id: str = ""
    external_chat_id: str = ""
    # WhatsApp @lid when known (even if external_chat_id is PN)
    wa_lid: str = ""
    post_token: str = ""
    ad_title: str = ""
    chat_type: str = "pv"
    wa_message_id: str = ""
    external_message_id: str = ""
    sender_type: str = "customer"
    trace_id: str = ""
    media_type: str = ""
    media_url: str = ""


class MessageOut(BaseModel):
    id: str
    account_id: str
    lead_id: str
    direction: str
    sender_type: str
    body: str
    agent_id: str | None
    created_at: datetime
    media_type: str = ""
    media_url: str = ""
    delivery_status: str = ""
    wa_message_id: str = ""


class MessageIngestOut(MessageOut):
    trace_id: str = ""
    auto_reply_status: str = ""  # queued | skipped | error
    auto_reply_reason: str = ""
    job_id: str = ""
    bot_paused: bool | None = None
    bot_command: str = ""  # stop | start | handoff | ""


class SendMessageIn(BaseModel):
    account_id: str
    lead_id: str | None = None
    target_name: str
    body: str
    sender_type: str = "agent"


class OutboundJobOut(BaseModel):
    id: str
    account_id: str
    lead_id: str | None
    target_name: str
    body: str
    sender_type: str
    status: str
    target_jid: str = ""


class KnowledgeIn(BaseModel):
    title: str
    content: str


class SuggestIn(BaseModel):
    lead_id: str
    message: str


class SuggestOut(BaseModel):
    reply: str
    confidence: float
    sources: list[str]


class AiPolicyIn(BaseModel):
    auto_send_enabled: bool = False
    group_auto_send_enabled: bool = False
    # off = no group AI (default); keywords = reply only when a keyword matches
    group_reply_mode: str = "off"
    group_keywords: list[str] = Field(default_factory=list)
    min_confidence: float = 0.45
    allowed_stages: list[str] = Field(default_factory=lambda: ["جدید", "پیگیری", "پیشنهاد"])
    business_hours_only: bool = False
    hours_start: str = "09:00"
    hours_end: str = "18:00"
    agent_role: str = ""
    system_prompt: str = ""
    # Empty string = use platform global fallback_message
    fallback_message: str = ""
    auto_apply_stage: bool = False
    pause_bot_on_escalate: bool = True


class CampaignSegmentIn(BaseModel):
    tags: list[str] = Field(default_factory=list)
    stages: list[str] = Field(default_factory=list)
    min_score: float = 0
    include_groups: bool = False


class CampaignIn(BaseModel):
    name: str
    message_template: str = ""
    channel_account_id: str | None = None
    segment: CampaignSegmentIn = Field(default_factory=CampaignSegmentIn)


class CampaignOut(BaseModel):
    id: str
    name: str
    status: str
    segment: dict
    message_template: str
    channel_account_id: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    sends_total: int = 0
    sends_queued: int = 0
    sends_sent: int = 0
    sends_failed: int = 0
    sends_skipped: int = 0
    audience_count: int = 0


class OkrIn(BaseModel):
    title: str
    description: str = ""
    target_value: float = 0
    current_value: float = 0
    period: str = "quarter"
    owner_id: str | None = None


class OkrOut(BaseModel):
    id: str
    title: str
    description: str
    target_value: float
    current_value: float
    period: str
    owner_id: str | None
    progress: float


class PirProfileIn(BaseModel):
    niche: str = ""
    audience: str = ""
    tone: str = ""
    goals: list[str] = []
    offers: str = ""
    banned_phrases: str = ""
    wizard_completed: bool = False
    apply_prompts: bool = True


class PirProfileOut(BaseModel):
    niche: str = ""
    audience: str = ""
    tone: str = ""
    goals: list[str] = []
    offers: str = ""
    banned_phrases: str = ""
    wizard_completed: bool = False
    updated_at: datetime | None = None


class PirChatIn(BaseModel):
    message: str


class PirChatMessageOut(BaseModel):
    id: str
    role: str
    body: str
    created_at: datetime


class PirChatOut(BaseModel):
    reply: str
    message: PirChatMessageOut
    provider: str = ""
    model: str = ""
