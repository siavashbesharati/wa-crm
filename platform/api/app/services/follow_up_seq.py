"""Automatic follow-up when an inbound message got no outbound reply."""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    AiPolicy,
    Lead,
    LeadAccountLink,
    Message,
    MessageDirection,
    OutboundJob,
    OutboundStatus,
    SenderType,
)
from app.services.queue import enqueue

# Hours after trigger before each step fires (relative to schedule time).
FOLLOW_UP_DELAYS_H = (2.0, 22.0)
FOLLOW_UP_MAX_STEPS = len(FOLLOW_UP_DELAYS_H)

# Auto-reply skip reasons where we should NOT schedule a silent follow-up.
_NO_FOLLOWUP_REASONS = frozenset(
    {
        "bot_paused",
        "already_processing",
        "already_queued",
        "lead_or_msg_missing",
        "org_missing",
        "empty_body",
        "media_placeholder",
        "auto_send_disabled",  # cannot send; task path covers sales intent
    }
)

_STEP_PROMPTS = (
    "پیام کوتاه و مودبانه فارسی بنویس که پیگیری کند؛ یک سوال باز بپرس. حداکثر ۲ جمله.",
    "پیام کوتاه فارسی بنویس؛ ارزش یا پیشنهاد ملایم بده و دعوت به ادامه گفتگو. حداکثر ۳ جمله.",
)


def should_schedule_after_auto_reply(auto_reply: dict | None) -> bool:
    if not auto_reply:
        return True
    status = str(auto_reply.get("status") or "").strip().lower()
    if status in ("queued", "ok", "sent"):
        return False
    reason = str(auto_reply.get("reason") or "").strip().lower()
    if reason in _NO_FOLLOWUP_REASONS:
        return False
    return status == "skipped" or status == "error"


def schedule_follow_up(
    *,
    org_id: str,
    lead_id: str,
    trigger_message_id: str,
    step: int = 0,
    reason: str = "no_reply",
) -> dict[str, Any] | None:
    """Enqueue a delayed follow-up job. step is 0-based."""
    if step < 0 or step >= FOLLOW_UP_MAX_STEPS:
        return None
    delay_h = FOLLOW_UP_DELAYS_H[step]
    run_at_ts = time.time() + delay_h * 3600.0
    payload = {
        "org_id": org_id,
        "lead_id": lead_id,
        "trigger_message_id": trigger_message_id,
        "step": step,
        "run_at_ts": run_at_ts,
        "reason": reason,
    }
    enqueue("follow_up", payload)
    return payload


def mark_follow_up_plan(lead: Lead, payload: dict[str, Any], *, status: str = "scheduled") -> None:
    meta = dict(lead.ai_meta or {}) if isinstance(lead.ai_meta, dict) else {}
    meta["follow_up_plan"] = {
        "status": status,
        "step": int(payload.get("step") or 0),
        "trigger_message_id": str(payload.get("trigger_message_id") or ""),
        "run_at_ts": float(payload.get("run_at_ts") or 0),
        "reason": str(payload.get("reason") or ""),
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    lead.ai_meta = meta


def _has_outbound_since(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    after: datetime | None,
) -> bool:
    q = db.query(Message.id).filter(
        Message.org_id == org_id,
        Message.lead_id == lead_id,
        Message.direction == MessageDirection.outbound,
    )
    if after is not None:
        q = q.filter(Message.created_at > after)
    return q.first() is not None


def _compose_follow_up_text(
    db: Session,
    *,
    org_id: str,
    lead: Lead,
    step: int,
    trigger_body: str,
) -> str:
    from app.services.ai_reply import (
        format_chat_history,
        generate_llm_text,
        get_platform_ai_settings,
        llm_is_configured,
        load_chat_history,
    )

    fallbacks = (
        f"سلام {lead.name or 'عزیز'}، پیام‌تون رو دیدم. هنوز آنلاین هستید؟",
        f"سلام مجدد، خواستم ببینم برای ادامه مسیر کمکی از دست ما برمیاد؟",
    )
    fallback = fallbacks[min(step, len(fallbacks) - 1)]
    platform = get_platform_ai_settings(db)
    if not llm_is_configured(platform):
        return fallback

    history = load_chat_history(db, org_id=org_id, lead_id=lead.id, limit=8)
    history_text = format_chat_history(history, current_message=trigger_body)
    instruction = _STEP_PROMPTS[min(step, len(_STEP_PROMPTS) - 1)]
    try:
        result = generate_llm_text(
            platform,
            system_prompt=(
                "تو فروشنده مودب واتساپ برای کسب‌وکار ایرانی هستی. "
                "فقط متن پیام را بنویس؛ بدون نقل‌قول و بدون توضیح."
            ),
            user_prompt=(
                f"نام مشتری: {lead.name or 'مشتری'}\n"
                f"مرحله: {lead.stage or 'جدید'}\n"
                f"تاریخچه:\n{history_text}\n\n"
                f"دستور: {instruction}"
            ),
            temperature=0.4,
        )
        text = str(result.get("reply") or "").strip()
        return text[:500] if text else fallback
    except Exception:  # noqa: BLE001
        return fallback


def handle_follow_up_job(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Send one follow-up if still unanswered; may schedule the next step."""
    org_id = str(payload.get("org_id") or "")
    lead_id = str(payload.get("lead_id") or "")
    trigger_id = str(payload.get("trigger_message_id") or "")
    step = int(payload.get("step") or 0)

    lead = db.get(Lead, lead_id)
    if not lead or lead.org_id != org_id:
        return {"status": "skipped", "reason": "lead_missing"}
    if lead.bot_paused:
        mark_follow_up_plan(lead, payload, status="cancelled_bot_paused")
        db.add(lead)
        return {"status": "skipped", "reason": "bot_paused"}

    policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
    if not policy or not policy.auto_send_enabled:
        mark_follow_up_plan(lead, payload, status="cancelled_auto_send_off")
        db.add(lead)
        return {"status": "skipped", "reason": "auto_send_disabled"}

    if (lead.chat_type or "").lower() == "group" or (lead.group_id or "").strip():
        mark_follow_up_plan(lead, payload, status="cancelled_group")
        db.add(lead)
        return {"status": "skipped", "reason": "group_chat"}

    allowed = list(policy.allowed_stages or [])
    if allowed and (lead.stage or "") not in allowed:
        mark_follow_up_plan(lead, payload, status="cancelled_stage")
        db.add(lead)
        return {"status": "skipped", "reason": "stage_not_allowed"}

    trigger = db.get(Message, trigger_id) if trigger_id else None
    after = trigger.created_at if trigger else None
    if _has_outbound_since(db, org_id=org_id, lead_id=lead_id, after=after):
        mark_follow_up_plan(lead, payload, status="cancelled_already_replied")
        db.add(lead)
        return {"status": "skipped", "reason": "already_replied"}

    # Prefer account from trigger message, else any link
    link = None
    account_id = ""
    if trigger and trigger.account_id:
        account_id = trigger.account_id
        link = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.lead_id == lead_id,
                LeadAccountLink.account_id == account_id,
            )
            .first()
        )
    if not link:
        link = (
            db.query(LeadAccountLink)
            .filter(LeadAccountLink.org_id == org_id, LeadAccountLink.lead_id == lead_id)
            .first()
        )
    if not link:
        return {"status": "skipped", "reason": "no_account_link"}
    account_id = account_id or link.account_id

    from app.services.wa_jid import resolve_outbound_target, resolve_target_jid

    body = _compose_follow_up_text(
        db,
        org_id=org_id,
        lead=lead,
        step=step,
        trigger_body=(trigger.body if trigger else "") or "",
    )
    target = resolve_outbound_target(lead, link)
    job = OutboundJob(
        org_id=org_id,
        account_id=account_id,
        lead_id=lead_id,
        target_name=target,
        target_jid=resolve_target_jid(lead, link),
        body=body,
        sender_type=SenderType.ai,
        status=OutboundStatus.queued,
    )
    db.add(job)
    db.add(
        Message(
            org_id=org_id,
            account_id=account_id,
            lead_id=lead_id,
            direction=MessageDirection.outbound,
            sender_type=SenderType.ai,
            body=body,
            delivery_status="pending",
        )
    )
    mark_follow_up_plan(lead, payload, status="sent")
    db.add(lead)

    try:
        from app.services.sse_hub import publish_job_ready

        db.flush()
        publish_job_ready(account_id, job_id=job.id, reason="follow_up", org_id=org_id)
    except Exception:  # noqa: BLE001
        pass

    next_step = step + 1
    next_payload = None
    if next_step < FOLLOW_UP_MAX_STEPS:
        next_payload = schedule_follow_up(
            org_id=org_id,
            lead_id=lead_id,
            trigger_message_id=trigger_id,
            step=next_step,
            reason=str(payload.get("reason") or "no_reply"),
        )
        if next_payload:
            mark_follow_up_plan(lead, next_payload, status="scheduled")
            db.add(lead)

    return {
        "status": "queued",
        "job_id": job.id,
        "step": step,
        "next_step": next_step if next_payload else None,
    }
