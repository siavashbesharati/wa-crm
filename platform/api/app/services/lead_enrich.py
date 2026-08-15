"""Structured LLM lead enrichment from conversation history."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models import AiPolicy, Lead, Task, TaskStatus
from app.services.ai_reply import (
    format_chat_history,
    generate_llm_text,
    get_platform_ai_settings,
    llm_is_configured,
    load_chat_history,
)
from app.services.crm_taxonomy import (
    ALLOWED_TAGS,
    FUNNEL_STAGES,
    filter_tags,
    is_terminal_stage,
    normalize_sentiment,
    normalize_stage,
)

ENRICH_SYSTEM = (
    "تو تحلیل‌گر CRM محافظه‌کار برای کسب‌وکار ایرانی هستی. "
    "هدف: برچسب‌گذاری دقیق فروش/پشتیبانی — نه متوقف‌کردن بی‌دلیل ربات. "
    "فقط یک آبجکت JSON معتبر برگردان؛ بدون مارک‌داون و بدون توضیح اضافه."
)

# Soft purchase / sales signals (do not treat as escalation)
_BUY_INTENT_RE = re.compile(
    r"(خرید|می\s*خوام\s*بخر|می‌خوام\s*بخر|سفارش|قیمت|رزرو|پرداخت|بخرم|خریدن)",
    re.IGNORECASE,
)
_HARD_ESCALATION_RE = re.compile(
    r"(شکایت|کلاهبردار|پول\s*من|وکیل|نارضای|مسخره|آشغال|دروغ|"
    r"با\s*انسان|با\s*کارشناس|اپراتور|مدیر|پشتیبان\s*انسان|"
    r"speak\s*to\s*(a\s*)?human|talk\s*to\s*(a\s*)?human|complaint|refund|scam)",
    re.IGNORECASE,
)

RISK_TAGS = frozenset({"churn_risk", "detractor", "needs_human", "complaint"})
ESCALATION_CONFIDENCE_MIN = 0.72

_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def _extract_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        return {}
    m = _JSON_FENCE.search(raw)
    if m:
        raw = m.group(1).strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                return data if isinstance(data, dict) else {}
            except json.JSONDecodeError:
                return {}
        return {}


def _clamp_score(value: Any) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, min(100.0, n)), 1)


def _clamp_confidence(value: Any) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.5
    if n > 1.0 and n <= 100.0:
        n = n / 100.0
    return round(max(0.0, min(1.0, n)), 3)


def _clamp_intent(value: Any) -> float:
    """Buying-intent percent 0–100 (distinct from general lead_score)."""
    return _clamp_score(value)


def _looks_like_buy_intent(text: str) -> bool:
    return bool(_BUY_INTENT_RE.search(text or ""))


def estimate_buying_intent(
    *,
    message: str = "",
    tags: list[str] | None = None,
    lead_score: float = 0.0,
    llm_intent: Any = None,
) -> float:
    """Prefer LLM value when present; otherwise derive from tags/score/text cues."""
    if llm_intent is not None and str(llm_intent).strip() != "":
        try:
            return _clamp_intent(llm_intent)
        except (TypeError, ValueError):
            pass
    score = 25.0
    tagset = {str(t).lower() for t in (tags or [])}
    if "ready_to_buy" in tagset:
        score = max(score, 88.0)
    elif "high_intent" in tagset:
        score = max(score, 75.0)
    elif "price_sensitive" in tagset or "info_seeking" in tagset:
        score = max(score, 55.0)
    elif "qualified" in tagset:
        score = max(score, 60.0)
    if "low_intent" in tagset or "unqualified" in tagset:
        score = min(score, 30.0)
    if _looks_like_buy_intent(message):
        score = max(score, 70.0)
        if re.search(r"خرید|بخرم|سفارش|رزرو", message or ""):
            score = max(score, 82.0)
    # Blend lightly with lead_score so they stay related but not identical
    ls = _clamp_score(lead_score)
    blended = score * 0.7 + ls * 0.3
    return _clamp_intent(blended)


def _looks_like_hard_escalation(text: str) -> bool:
    return bool(_HARD_ESCALATION_RE.search(text or ""))


def sanitize_enrichment(
    parsed: dict[str, Any],
    *,
    message: str = "",
) -> dict[str, Any]:
    """Drop false-positive risk/escalation for normal sales chats."""
    tags_add = list(parsed.get("tags_add") or [])
    tags_remove = list(parsed.get("tags_remove") or [])
    sentiment = normalize_sentiment(str(parsed.get("sentiment") or ""))
    confidence = _clamp_confidence(parsed.get("confidence"))
    escalation = bool(parsed.get("escalation"))
    score = _clamp_score(parsed.get("lead_score"))
    msg = (message or "").strip()
    buying_intent = estimate_buying_intent(
        message=msg,
        tags=tags_add,
        lead_score=score,
        llm_intent=parsed.get("buying_intent"),
    )

    buyish = _looks_like_buy_intent(msg)
    hard = _looks_like_hard_escalation(msg)

    # Purchase interest is sales signal, not human escalation
    if buyish and not hard and sentiment != "negative":
        tags_add = [t for t in tags_add if t not in RISK_TAGS]
        escalation = False
        if "high_intent" not in tags_add:
            tags_add.append("high_intent")
        if "ready_to_buy" not in tags_add and re.search(r"خرید|بخرم|سفارش", msg):
            tags_add.append("ready_to_buy")
        # Clear stale risk tags on this lead when chat is clearly buying
        for t in RISK_TAGS:
            if t not in tags_remove:
                tags_remove.append(t)
        score = max(score, 70.0)
        buying_intent = max(buying_intent, 75.0)
        if not parsed.get("suggested_stage"):
            parsed["suggested_stage"] = "پیگیری"

    # needs_human / complaint / churn without negative tone or hard cue → drop
    if sentiment != "negative" and not hard:
        tags_add = [t for t in tags_add if t not in RISK_TAGS]
        if not hard:
            escalation = False

    # Low-confidence risk claims are ignored
    if confidence < ESCALATION_CONFIDENCE_MIN and not hard:
        tags_add = [t for t in tags_add if t not in RISK_TAGS]
        escalation = False

    # Only force escalation when negative + risk tag, or hard customer cue
    if hard and sentiment != "positive":
        escalation = True
        if "needs_human" not in tags_add:
            tags_add.append("needs_human")
    elif RISK_TAGS.intersection(tags_add) and sentiment == "negative" and confidence >= ESCALATION_CONFIDENCE_MIN:
        escalation = True
    else:
        # Do not keep LLM escalation=true alone without evidence
        if escalation and sentiment != "negative" and not hard:
            escalation = False

    parsed["tags_add"] = filter_tags(tags_add)
    parsed["tags_remove"] = filter_tags(tags_remove)
    parsed["sentiment"] = sentiment
    parsed["confidence"] = confidence
    parsed["escalation"] = escalation
    parsed["lead_score"] = score
    parsed["buying_intent"] = estimate_buying_intent(
        message=msg,
        tags=parsed["tags_add"],
        lead_score=score,
        llm_intent=buying_intent,
    )
    return parsed


def parse_enrichment(raw: dict[str, Any] | None, *, message: str = "") -> dict[str, Any]:
    data = raw or {}
    tags_add = filter_tags(data.get("tags_add") if isinstance(data.get("tags_add"), list) else [])
    tags_remove = filter_tags(
        data.get("tags_remove") if isinstance(data.get("tags_remove"), list) else []
    )
    note = str(data.get("note") or "").strip()[:800]
    sentiment = normalize_sentiment(str(data.get("sentiment") or ""))
    lead_score = _clamp_score(data.get("lead_score"))
    suggested = normalize_stage(str(data.get("suggested_stage") or ""))
    confidence = _clamp_confidence(data.get("confidence"))
    escalation = bool(data.get("escalation"))
    buying_intent = data.get("buying_intent")

    task_out = None
    task = data.get("task")
    if isinstance(task, dict):
        title = str(task.get("title") or "").strip()[:200]
        message_body = str(task.get("message") or "").strip()[:1000]
        try:
            due_hours = float(task.get("due_hours") if task.get("due_hours") is not None else 24)
        except (TypeError, ValueError):
            due_hours = 24.0
        due_hours = max(1.0, min(168.0, due_hours))
        if title or message_body:
            task_out = {
                "title": title or (message_body[:80] if message_body else "پیگیری AI"),
                "message": message_body or title,
                "due_hours": due_hours,
            }

    parsed = {
        "tags_add": tags_add,
        "tags_remove": tags_remove,
        "note": note,
        "sentiment": sentiment,
        "lead_score": lead_score,
        "suggested_stage": suggested,
        "task": task_out,
        "escalation": escalation,
        "confidence": confidence,
        "buying_intent": buying_intent,
    }
    return sanitize_enrichment(parsed, message=message)


def build_enrich_prompts(*, lead: Lead, history_text: str, message: str) -> tuple[str, str]:
    allowed = ", ".join(sorted(ALLOWED_TAGS))
    stages = ", ".join(FUNNEL_STAGES)
    current_tags = ", ".join(lead.tags or []) or "(none)"
    user = (
        f"نام لید: {lead.name or 'مشتری'}\n"
        f"مرحله فعلی: {lead.stage or 'جدید'}\n"
        f"برچسب‌های فعلی: {current_tags}\n"
        f"امتیاز فعلی: {getattr(lead, 'lead_score', 0) or 0}\n\n"
        f"تاریخچه گفتگو:\n{history_text}\n\n"
        f"آخرین پیام مشتری:\n{(message or '').strip()}\n\n"
        "قواعد مهم (حتماً رعایت کن):\n"
        "- پیام‌هایی مثل «می‌خوام خرید کنم»، سوال قیمت، یا درخواست اطلاعات = فروش عادی.\n"
        "  برچسب‌های مناسب: high_intent / ready_to_buy / info_seeking / price_sensitive.\n"
        "  escalation=false و هرگز needs_human / churn_risk / complaint نگذار.\n"
        "- needs_human یا escalation=true فقط وقتی مشتری عصبانی است، شکایت دارد، "
        "تهدید حقوقی می‌کند، یا صریحاً می‌خواهد با انسان حرف بزند.\n"
        "- احساس negative را برای خرید عادی استفاده نکن؛ معمولاً neutral یا positive است.\n"
        "- اگر مطمئن نیستی، محافظه‌کار باش: escalation=false و بدون برچسب ریسک.\n\n"
        "خروجی JSON با این کلیدها:\n"
        "{\n"
        '  "tags_add": [],\n'
        '  "tags_remove": [],\n'
        '  "note": "خلاصه کوتاه فارسی برای یادداشت CRM",\n'
        '  "sentiment": "positive|neutral|negative",\n'
        '  "lead_score": 0-100,\n'
        '  "buying_intent": 0-100,\n'
        f'  "suggested_stage": یکی از [{stages}],\n'
        '  "task": null یا {"title":"...","message":"...","due_hours":24},\n'
        '  "escalation": false,\n'
        '  "confidence": 0-1\n'
        "}\n"
        "buying_intent = احتمال خرید همین گفتگو (جدا از lead_score کلی).\n"
        "ready_to_buy≈۸۵–۹۵، high_intent≈۷۰–۸۵، سوال قیمت≈۵۵–۷۰، کنجکاوی≈۳۰–۵۰.\n"
        f"فقط از این برچسب‌ها استفاده کن: {allowed}\n"
        "اگر پیگیری فوری لازم نیست task را null بگذار."
    )
    return ENRICH_SYSTEM, user


def generate_enrichment(
    db: Session,
    *,
    org_id: str,
    lead: Lead,
    message: str,
) -> dict[str, Any]:
    platform = get_platform_ai_settings(db)
    if not llm_is_configured(platform):
        return parse_enrichment(
            {
                "tags_add": [],
                "note": "",
                "sentiment": "neutral",
                "lead_score": float(getattr(lead, "lead_score", 0) or 0),
                "suggested_stage": lead.stage,
                "confidence": 0.0,
            },
            message=message,
        )

    history = load_chat_history(db, org_id=org_id, lead_id=lead.id, limit=12)
    history_text = format_chat_history(history, current_message=message)
    system_prompt, user_prompt = build_enrich_prompts(
        lead=lead, history_text=history_text, message=message
    )
    try:
        result = generate_llm_text(
            platform,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.2,
        )
        parsed = parse_enrichment(_extract_json(str(result.get("reply") or "")), message=message)
        parsed["provider"] = result.get("provider")
        parsed["model"] = result.get("model")
        return parsed
    except Exception as exc:  # noqa: BLE001
        return parse_enrichment(
            {
                "tags_add": [],
                "note": "",
                "sentiment": "neutral",
                "lead_score": float(getattr(lead, "lead_score", 0) or 0),
                "suggested_stage": lead.stage,
                "confidence": 0.0,
                "error": str(exc)[:200],
            },
            message=message,
        )


def merge_tags(current: list[str] | None, add: list[str], remove: list[str]) -> list[str]:
    cur = filter_tags(list(current or []))
    rem = set(filter_tags(remove))
    out = [t for t in cur if t not in rem]
    seen = set(out)
    for t in add:
        if t not in seen:
            out.append(t)
            seen.add(t)
    return out


def append_ai_note(notes: str, note: str, *, when: datetime | None = None) -> str:
    text = (note or "").strip()
    if not text:
        return notes or ""
    ts = (when or datetime.utcnow()).strftime("%Y-%m-%d %H:%M")
    line = f"[AI {ts}] {text}"
    existing = (notes or "").rstrip()
    if line in existing:
        return existing
    return f"{existing}\n{line}".strip() if existing else line


def should_auto_apply_stage(
    policy: AiPolicy | None,
    *,
    current_stage: str,
    suggested: str | None,
    confidence: float,
) -> bool:
    if not policy or not getattr(policy, "auto_apply_stage", False):
        return False
    if not suggested or suggested == current_stage:
        return False
    if is_terminal_stage(suggested):
        return False
    if is_terminal_stage(current_stage):
        return False
    # Never leave the auto-reply stage allow-list — otherwise AI stops answering
    allowed = list(policy.allowed_stages or [])
    if allowed and suggested not in allowed:
        return False
    min_c = float(getattr(policy, "min_confidence", 0.45) or 0.45)
    return confidence >= min_c


def maybe_create_ai_task(
    db: Session,
    *,
    org_id: str,
    lead: Lead,
    task_spec: dict[str, Any] | None,
    source_message_id: str = "",
) -> Any | None:
    if not task_spec:
        return None
    from app.services.contact_tasks import create_task_for_contact
    from fastapi import HTTPException

    title = str(task_spec.get("title") or "").strip()
    if not title:
        return None

    since = datetime.utcnow() - timedelta(hours=24)
    existing = (
        db.query(Task)
        .filter(
            Task.org_id == org_id,
            Task.lead_id == lead.id,
            Task.source == "ai",
            Task.status.in_([TaskStatus.open, TaskStatus.in_progress]),
            Task.created_at >= since,
        )
        .all()
    )
    for t in existing:
        if (t.title or "").strip() == title:
            return None

    due_hours = float(task_spec.get("due_hours") or 24)
    due_at = datetime.utcnow() + timedelta(hours=due_hours)
    try:
        return create_task_for_contact(
            db,
            org_id=org_id,
            lead_id=lead.id,
            title=title,
            message=str(task_spec.get("message") or ""),
            due_at=due_at,
            source="ai",
            source_message_id=source_message_id or "",
        )
    except HTTPException:
        return None


def apply_enrichment_to_lead(
    db: Session,
    *,
    org_id: str,
    lead: Lead,
    enrichment: dict[str, Any],
    message_id: str = "",
    policy: AiPolicy | None = None,
) -> dict[str, Any]:
    """Mutate lead from enrichment; caller commits. Returns applied summary."""
    tags_before = list(lead.tags or [])
    new_tags = merge_tags(
        tags_before,
        list(enrichment.get("tags_add") or []),
        list(enrichment.get("tags_remove") or []),
    )
    lead.tags = new_tags
    note = str(enrichment.get("note") or "").strip()
    if note:
        lead.notes = append_ai_note(lead.notes or "", note)

    score = _clamp_score(enrichment.get("lead_score"))
    lead.lead_score = score

    suggested = enrichment.get("suggested_stage")
    confidence = _clamp_confidence(enrichment.get("confidence"))
    stage_applied = False
    if should_auto_apply_stage(
        policy,
        current_stage=lead.stage or "",
        suggested=suggested,
        confidence=confidence,
    ):
        lead.stage = suggested
        stage_applied = True

    buying_intent = estimate_buying_intent(
        message="",
        tags=new_tags,
        lead_score=score,
        llm_intent=enrichment.get("buying_intent"),
    )

    meta = dict(lead.ai_meta or {}) if isinstance(lead.ai_meta, dict) else {}
    prev_mem = meta.get("memory") if isinstance(meta.get("memory"), dict) else {}
    prev_summary = str(prev_mem.get("summary") or "").strip()
    mem_summary = (note or prev_summary)[:400]
    meta.update(
        {
            "sentiment": enrichment.get("sentiment") or "neutral",
            "suggested_stage": suggested or "",
            "last_enriched_at": datetime.utcnow().isoformat() + "Z",
            "last_message_id": message_id or "",
            "confidence": confidence,
            "escalation": bool(enrichment.get("escalation")),
            "buying_intent": buying_intent,
            "memory": {
                "summary": mem_summary,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            },
        }
    )
    lead.ai_meta = meta
    lead.updated_at = datetime.utcnow()

    task = maybe_create_ai_task(
        db,
        org_id=org_id,
        lead=lead,
        task_spec=enrichment.get("task"),
        source_message_id=message_id,
    )

    escalated = False
    pause_bot = False
    sentiment = enrichment.get("sentiment") or "neutral"
    risk_on_lead = bool(RISK_TAGS.intersection(new_tags)) and sentiment == "negative"
    true_escalation = bool(enrichment.get("escalation")) and sentiment == "negative"
    true_escalation = true_escalation or risk_on_lead

    if true_escalation:
        escalated = True
        pause_on = True if policy is None else bool(getattr(policy, "pause_bot_on_escalate", True))
        # Pause only when tone is negative AND risk evidence exists.
        should_pause = pause_on and sentiment == "negative" and (
            bool(RISK_TAGS.intersection(new_tags)) or bool(enrichment.get("escalation"))
        )
        if should_pause and not lead.bot_paused:
            lead.bot_paused = True
            pause_bot = True
        if not task:
            task = maybe_create_ai_task(
                db,
                org_id=org_id,
                lead=lead,
                task_spec={
                    "title": "پیگیری اضطراری / ریسک از دست رفتن",
                    "message": note or "گفتگو نیاز به مداخله انسانی دارد.",
                    "due_hours": 4,
                },
                source_message_id=message_id,
            )
    elif not task and {"high_intent", "ready_to_buy"}.intersection(new_tags):
        # Soft sales follow-up — never pauses the bot
        task = maybe_create_ai_task(
            db,
            org_id=org_id,
            lead=lead,
            task_spec={
                "title": "پیگیری فرصت خرید",
                "message": note or "مشتری قصد خرید دارد؛ پیگیری فروش.",
                "due_hours": 24,
            },
            source_message_id=message_id,
        )

    return {
        "tags": new_tags,
        "tags_added": [t for t in new_tags if t not in tags_before],
        "lead_score": score,
        "buying_intent": buying_intent,
        "suggested_stage": suggested or "",
        "stage_applied": stage_applied,
        "stage": lead.stage,
        "task_id": getattr(task, "id", None),
        "escalated": escalated,
        "bot_paused": pause_bot,
        "sentiment": enrichment.get("sentiment") or "neutral",
        "confidence": confidence,
    }
