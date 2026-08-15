"""آقای پشمک — per-org business coach (wizard prompts + internal chat)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    AiPolicy,
    Campaign,
    CoachMessage,
    KnowledgeDoc,
    Lead,
    OrgCoachProfile,
    Organization,
    Task,
    TaskStatus,
)
from app.services.ai_reply import generate_llm_text, get_platform_ai_settings, retrieve_knowledge

COACH_HISTORY_LIMIT = 50
COACH_CONTEXT_MSG_CHARS = 600

# Floating mascot thresholds
EXHAUST_OPEN_TASKS = 8
IMPORTANT_LEAD_TAGS = frozenset({"churn_risk", "detractor", "complaint", "needs_human"})

GOAL_LABELS_FA = {
    "lead": "جذب لید",
    "booking": "رزرو / فروش",
    "support": "پشتیبانی",
    "recovery": "بازگردانی مشتری",
}

TONE_HINTS = {
    "رسمی": "مودب، مختصر و حرفه‌ای",
    "خودمانی": "صمیمی و روان، بدون لحن خشک اداری",
    "لوکس": "شیک، آرام و باکیفیت؛ بدون اغراق ارزان‌فروشی",
}


def coach_system_prompt() -> str:
    return (
        "تو «آقای پشمک» هستی — مربی و مشاور خردمند (با شخصیت گربه ایرانی بامزه و جدی) "
        "برای تیم فروش و پشتیبانی یک کسب‌وکار ایرانی. "
        "فقط به تیم داخلی مشاوره بده؛ هرگز وانمود نکن که پیام واتساپ یا دیوار می‌فرستی. "
        "پاسخ‌ها را به فارسی، کوتاه، عملی و قابل‌اجرا بنویس. "
        "در صورت نیاز پیشنهاد بده: بهبود دستور AI، افزودن دانش، ایده کمپین، پیگیری لیدهای در خطر. "
        "اگر داده کافی نداری، صادقانه بگو چه چیزی کم است. "
        "اگر بخش «### گزارش تحلیلی» یا «### لیدهای واقعی» در ورودی هست، نام لیدها را از همان‌جا بگو؛ "
        "رتبه یا نام جعل نکن. "
        "هرگز نگو «برو کانبان را ببین» — اگر لازم شد بگو بورد لیدها یا صفحه وظایف. "
        "برای سوال احتمال خرید / مذاکره / ریسک، حتماً نام واقعی از لیست را ذکر کن."
    )


def _normalize_goals(goals: list[str] | None) -> list[str]:
    allowed = set(GOAL_LABELS_FA.keys())
    out: list[str] = []
    seen: set[str] = set()
    for g in goals or []:
        key = str(g or "").strip().lower()
        if key in allowed and key not in seen:
            seen.add(key)
            out.append(key)
    return out


def profile_to_dict(row: OrgCoachProfile | None) -> dict[str, Any]:
    if not row:
        return {
            "niche": "",
            "audience": "",
            "tone": "",
            "goals": [],
            "offers": "",
            "banned_phrases": "",
            "wizard_completed": False,
            "updated_at": None,
        }
    return {
        "niche": row.niche or "",
        "audience": row.audience or "",
        "tone": row.tone or "",
        "goals": list(row.goals or []),
        "offers": row.offers or "",
        "banned_phrases": row.banned_phrases or "",
        "wizard_completed": bool(row.wizard_completed),
        "updated_at": row.updated_at,
    }


def build_prompts_from_profile(profile: OrgCoachProfile | dict[str, Any]) -> tuple[str, str]:
    """Return (agent_role, system_prompt) for the customer-facing bot."""
    if isinstance(profile, OrgCoachProfile):
        data = profile_to_dict(profile)
    else:
        data = dict(profile or {})

    niche = (data.get("niche") or "").strip() or "کسب‌وکار"
    audience = (data.get("audience") or "").strip() or "مشتریان"
    tone = (data.get("tone") or "").strip() or "رسمی"
    tone_hint = TONE_HINTS.get(tone, tone)
    offers = (data.get("offers") or "").strip()
    banned = (data.get("banned_phrases") or "").strip()
    goals = _normalize_goals(list(data.get("goals") or []))
    goal_fa = "، ".join(GOAL_LABELS_FA[g] for g in goals) if goals else "فروش و پشتیبانی"

    agent_role = f"دستیار فروش و پشتیبانی «{niche}» با لحن {tone}"[:200]

    lines = [
        f"تو نماینده فروش/پشتیبانی کسب‌وکار در حوزه «{niche}» هستی.",
        f"مخاطب هدف: {audience}.",
        f"لحن پاسخ: {tone_hint}.",
        f"هدف اصلی گفتگو: {goal_fa}.",
        "پاسخ را کوتاه، مودب و به فارسی بنویس. از تاریخچه گفتگو استفاده کن و سوال تکراری نپرس.",
    ]
    if offers:
        lines.append(f"محصولات/خدمات اصلی: {offers}")
    if banned:
        lines.append(f"از این عبارات یا وعده‌ها پرهیز کن: {banned}")
    lines.append(
        "اگر نمی‌دانی، صادقانه بگو و پیشنهاد بده با کارشناس صحبت کنند. قیمت یا تخفیف جعلی نساز."
    )
    return agent_role, "\n".join(lines)


def apply_prompts_to_policy(db: Session, *, org_id: str, profile: OrgCoachProfile) -> None:
    agent_role, system_prompt = build_prompts_from_profile(profile)
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
    if not policy:
        policy = AiPolicy(org_id=org_id)
        db.add(policy)
    policy.agent_role = agent_role
    policy.system_prompt = system_prompt
    db.add(policy)


def build_org_context(db: Session, org: Organization, profile: OrgCoachProfile | None) -> str:
    org_id = org.id
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
    kb_n = db.query(KnowledgeDoc).filter(KnowledgeDoc.org_id == org_id).count()
    open_tasks = (
        db.query(Task)
        .filter(
            Task.org_id == org_id,
            Task.status.in_((TaskStatus.open, TaskStatus.in_progress)),
        )
        .count()
    )
    leads = db.query(Lead).filter(Lead.org_id == org_id).limit(400).all()
    risk_n = 0
    paused_n = 0
    for lead in leads:
        if getattr(lead, "bot_paused", False):
            paused_n += 1
        tags = set(lead.tags or [])
        meta = getattr(lead, "ai_meta", None) or {}
        if "churn_risk" in tags or "complaint" in tags or meta.get("escalation"):
            risk_n += 1
        elif (meta.get("sentiment") or "") == "negative":
            risk_n += 1

    camps = (
        db.query(Campaign)
        .filter(Campaign.org_id == org_id)
        .order_by(Campaign.created_at.desc())
        .limit(3)
        .all()
    )
    camp_lines = []
    for c in camps:
        camp_lines.append(f"- {c.name}: وضعیت={c.status}")

    pdata = profile_to_dict(profile)
    goals_fa = "، ".join(GOAL_LABELS_FA.get(g, g) for g in (pdata.get("goals") or []))

    parts = [
        f"نام سازمان: {org.name}",
        f"پلن: {getattr(org, 'plan', '')}",
        "",
        "### پروفایل آقای پشمک",
        f"حوزه: {pdata.get('niche') or '—'}",
        f"مخاطب: {pdata.get('audience') or '—'}",
        f"لحن: {pdata.get('tone') or '—'}",
        f"اهداف: {goals_fa or '—'}",
        f"پیشنهادها: {(pdata.get('offers') or '—')[:400]}",
        f"ممنوعیات: {(pdata.get('banned_phrases') or '—')[:200]}",
        f"ویزارد تکمیل‌شده: {'بله' if pdata.get('wizard_completed') else 'خیر'}",
        "",
        "### تنظیمات AI",
    ]
    if policy:
        parts.extend(
            [
                f"ارسال خودکار: {'روشن' if policy.auto_send_enabled else 'خاموش'}",
                f"حداقل اطمینان: {policy.min_confidence}",
                f"ساعات کاری فقط: {'بله' if policy.business_hours_only else 'خیر'}",
                f"نقش عامل: {(policy.agent_role or '—')[:160]}",
            ]
        )
    else:
        parts.append("سیاست AI هنوز ساخته نشده.")

    parts.extend(
        [
            "",
            "### وضعیت CRM (خلاصه)",
            f"اسناد دانش: {kb_n}",
            f"وظایف باز: {open_tasks}",
            f"لیدهای پرریسک / منفی: {risk_n}",
            f"چت‌های ربات متوقف: {paused_n}",
            f"تعداد لید نمونه‌گیری‌شده: {len(leads)}",
        ]
    )
    if camp_lines:
        parts.append("کمپین‌های اخیر:")
        parts.extend(camp_lines)

    try:
        from app.services.org_analytics import lead_snapshot_for_context

        snap = lead_snapshot_for_context(db, org_id, limit=8)
        if snap:
            parts.extend(["", snap])
    except Exception:  # noqa: BLE001
        pass

    return "\n".join(parts)


def _trim_history(db: Session, org_id: str) -> None:
    rows = (
        db.query(CoachMessage)
        .filter(CoachMessage.org_id == org_id)
        .order_by(CoachMessage.created_at.desc())
        .offset(COACH_HISTORY_LIMIT)
        .all()
    )
    for row in rows:
        db.delete(row)


def list_messages(db: Session, org_id: str, *, limit: int = COACH_HISTORY_LIMIT) -> list[CoachMessage]:
    rows = (
        db.query(CoachMessage)
        .filter(CoachMessage.org_id == org_id)
        .order_by(CoachMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return list(reversed(rows))


def clear_messages(db: Session, org_id: str) -> int:
    rows = db.query(CoachMessage).filter(CoachMessage.org_id == org_id).all()
    n = len(rows)
    for row in rows:
        db.delete(row)
    return n


def run_coach_turn(
    db: Session,
    *,
    org: Organization,
    profile: OrgCoachProfile | None,
    user_id: str | None,
    message: str,
) -> dict[str, Any]:
    text = (message or "").strip()
    if not text:
        raise ValueError("پیام خالی است")

    user_msg = CoachMessage(
        org_id=org.id,
        user_id=user_id,
        role="user",
        body=text,
    )
    db.add(user_msg)
    db.flush()

    history = list_messages(db, org.id, limit=20)
    hist_lines = []
    for m in history:
        if m.id == user_msg.id:
            continue
        role = "کاربر" if m.role == "user" else "آقای پشمک"
        body = (m.body or "")[:COACH_CONTEXT_MSG_CHARS]
        hist_lines.append(f"{role}: {body}")

    ctx = build_org_context(db, org, profile)
    kb_bits = ""
    try:
        hits = retrieve_knowledge(db, org.id, text, k=3)
        if hits:
            lines = []
            for chunk, score in hits:
                content = (getattr(chunk, "content", None) or "")[:300]
                if content:
                    lines.append(f"- ({score:.2f}) {content}")
            if lines:
                kb_bits = "\n\n### دانش مرتبط\n" + "\n".join(lines)
    except Exception:  # noqa: BLE001
        kb_bits = ""

    analytics_bits = ""
    try:
        from app.services.org_analytics import analytics_for_message

        report = analytics_for_message(db, org.id, text)
        if report:
            analytics_bits = "\n\n" + report
    except Exception:  # noqa: BLE001
        analytics_bits = ""

    system = coach_system_prompt()
    user_prompt = (
        f"{ctx}{kb_bits}{analytics_bits}\n\n"
        f"### تاریخچه گفتگوی مربی\n"
        f"{chr(10).join(hist_lines) if hist_lines else '(خالی)'}\n\n"
        f"### سوال کاربر تیم\n{text}\n\n"
        "پاسخ آقای پشمک:"
    )

    platform = get_platform_ai_settings(db)
    try:
        result = generate_llm_text(platform, system_prompt=system, user_prompt=user_prompt, temperature=0.5)
        reply = (result.get("reply") or "").strip()
        provider = str(result.get("provider") or "")
        model = str(result.get("model") or "")
    except Exception as exc:  # noqa: BLE001
        reply = (
            "الان نتوانستم به مدل زبان وصل شوم. "
            f"({exc}) "
            "تنظیمات AI پلتفرم را بررسی کنید؛ در عین حال می‌توانید پروفایل ویزارد را تکمیل کنید."
        )
        provider = ""
        model = ""

    if not reply:
        reply = "پاسخی تولید نشد. لطفاً دوباره بپرسید یا پروفایل کسب‌وکار را کامل‌تر کنید."

    assistant = CoachMessage(
        org_id=org.id,
        user_id=None,
        role="assistant",
        body=reply,
    )
    db.add(assistant)
    _trim_history(db, org.id)
    db.flush()
    return {
        "reply": reply,
        "message": assistant,
        "provider": provider,
        "model": model,
    }


def _lead_is_important(lead: Lead) -> bool:
    tags = set(lead.tags or [])
    if tags.intersection(IMPORTANT_LEAD_TAGS - {"needs_human"}):
        return True
    meta = getattr(lead, "ai_meta", None) or {}
    if meta.get("escalation"):
        return True
    sentiment = str(meta.get("sentiment") or "").lower()
    if "needs_human" in tags and sentiment == "negative":
        return True
    if sentiment == "negative" and tags.intersection({"churn_risk", "detractor", "complaint"}):
        return True
    return False


def compute_mascot_mood(db: Session, org_id: str) -> dict[str, Any]:
    """Pick floating-cat pose from open tasks + important leads.

    Priority: alert > exhaust > happy > normal
    """
    open_tasks = (
        db.query(Task)
        .filter(
            Task.org_id == org_id,
            Task.status.in_((TaskStatus.open, TaskStatus.in_progress)),
        )
        .count()
    )
    leads = db.query(Lead).filter(Lead.org_id == org_id).limit(400).all()
    important = sum(1 for lead in leads if _lead_is_important(lead))

    if important > 0:
        mood = "alert"
    elif open_tasks >= EXHAUST_OPEN_TASKS:
        mood = "exhaust"
    elif open_tasks == 0:
        mood = "happy"
    else:
        mood = "normal"

    return {
        "mood": mood,
        "open_tasks": open_tasks,
        "important_leads": important,
        "exhaust_threshold": EXHAUST_OPEN_TASKS,
    }
