"""Org-scoped CRM analytics for آقای میوژن (SQL rankings, never cross-tenant)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Lead, Message, MessageDirection, SenderType, Task, TaskStatus, User

TOP_N = 10
SALES_DAYS = 30
ACTIVITY_DAYS = 7
HOT_HOURS = 24
PLAYBOOK_MSG_LIMIT = 10

OPEN_FUNNEL_STAGES = ("جدید", "پیگیری", "پیشنهاد")
CLOSED_STAGE = "خرید"

# Intent keys
INTENT_TOP_SELLER = "top_seller"
INTENT_TOP_OPERATOR = "top_operator"
INTENT_TOP_BUYER = "top_buyer"
INTENT_HOT_TODAY = "hot_today"
INTENT_RISK = "risk_leads"
INTENT_OPEN_LEADS = "open_leads"
INTENT_TASKS_COMPLETED = "tasks_completed"
INTENT_LEAD_PLAYBOOK = "lead_playbook"

ANALYTICS_KINDS = frozenset(
    {
        INTENT_TOP_SELLER,
        INTENT_TOP_OPERATOR,
        INTENT_TOP_BUYER,
        INTENT_HOT_TODAY,
        INTENT_RISK,
        INTENT_OPEN_LEADS,
        INTENT_TASKS_COMPLETED,
        INTENT_LEAD_PLAYBOOK,
    }
)

# (intent, phrases) — first match wins per intent; max 2 intents returned
_INTENT_PHRASES: list[tuple[str, tuple[str, ...]]] = [
    (
        INTENT_TASKS_COMPLETED,
        (
            "تسک های بیشتری",
            "تسک‌های بیشتری",
            "وظایف بیشتری",
            "بیشترین تسک",
            "بیشترین وظیفه",
            "تسک انجام داده",
            "وظیفه انجام داده",
            "کدوم کارمند تسک",
            "کدام کارمند تسک",
            "tasks completed",
            "most tasks",
            "رتبه وظایف",
            "کارمند پرتسک",
            "بیشترین کار انجام",
        ),
    ),
    (
        INTENT_LEAD_PLAYBOOK,
        (
            "پیشنهاداتون",
            "پیشنهادات شما",
            "پیشنهاد چیه",
            "پیشنهادات چیه",
            "بر اساس گفتگو",
            "بر اساس گفت و گو",
            "بر اساس آنالیز",
            "بر اساس انالیز",
            "تحلیل گفتگو",
            "آنالیز گفتگو",
            "انالیز گفتگو",
            "انالیز گفت و گو",
            "گفت و گو ها",
            "گفتگوها",
            "playbook",
            "چه کار کنیم",
            "چی پیشنهاد",
            "اقدام بعدی",
            "قدم بعدی",
        ),
    ),
    (
        INTENT_TOP_SELLER,
        (
            "فروشنده برتر",
            "برترین فروشنده",
            "بهترین فروشنده",
            "top seller",
            "topseller",
            "بیشترین فروش",
            "کی بیشتر فروخت",
            "چه کسی بیشتر فروخت",
        ),
    ),
    (
        INTENT_TOP_OPERATOR,
        (
            "اپراتور کارآمد",
            "کارآمدترین اپراتور",
            "کارامدترین اپراتور",
            "بهترین اپراتور",
            "اپراتور برتر",
            "efficient operator",
            "top operator",
            "کارآمدتر",
            "کارامدتر",
            "بهره‌ورترین",
            "بهره ورترین",
        ),
    ),
    (
        INTENT_TOP_BUYER,
        (
            "خریداران برتر",
            "خریدار برتر",
            "بهترین خریدار",
            "top buyer",
            "top buyers",
            "مشتریان خرید کرده",
            "لیدهای خرید",
            "چه کسانی خریدند",
        ),
    ),
    (
        INTENT_HOT_TODAY,
        (
            "پتانسیل خرید",
            "پتانسیل خرید بیشتری",
            "بیشترین پتانسیل",
            "پتانسیل ها",
            "پتانسیل‌ها",
            "احتمال خرید",
            "امکان خرید",
            "لیدهای داغ",
            "داغ ترین",
            "داغ‌ترین",
            "داغترین",
            "داغ امروز",
            "ده تا از داغ",
            "۱۰ تا از داغ",
            "10 تا از داغ",
            "امروز چه لید",
            "همین امروز",
            "امروز داره",
            "امروز دارد",
            "کی امروز",
            "hot today",
            "hot leads",
            "buy today",
            "کی امروز می‌خرد",
            "کی امروز میخرد",
            "بیشترین شانس خرید",
            "آماده خرید",
            "اسمش رو بگو",
            "اسم‌ش رو بگو",
            "اسم لید",
            "کدام لید",
            "کدوم لید",
            "بیشتر احتمال",
            "احتمال میدی",
            "احتمال میدی بخره",
            "کی رو بیشتر",
            "کی بیشتر احتمال",
            "بخره",
            "می‌خره",
            "میخره",
        ),
    ),
    (
        INTENT_RISK,
        (
            "ریسک از دست",
            "از دست رفتن",
            "مداخله انسانی",
            "نیاز به مداخله",
            "نیاز به کارشناس",
            "پرریسک",
            "پر ریسک",
            "churn",
            "needs_human",
            "شکایت",
            "ناراضی",
            "escalation",
            "خطر از دست",
        ),
    ),
    (
        INTENT_OPEN_LEADS,
        (
            "در حال مذاکره",
            "لیدهای در حال",
            "لید های در حال",
            "لیست لید",
            "لیدهای باز",
            "لید های باز",
            "چه لیدهایی داریم",
            "کیا هستن",
            "کیان هستن",
            "مرحله پیگیری",
            "مرحله پیشنهاد",
            "لیدهای پیگیری",
            "لیدهای پیشنهاد",
        ),
    ),
]

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")


def parse_requested_limit(message: str, default: int = TOP_N) -> int:
    """Extract N from phrases like «ده تا»، «۱۰ لید»، «top 10»."""
    text = (message or "").strip().lower().translate(_FA_DIGITS)
    text = text.replace("ي", "ی").replace("ك", "ک")
    word_map = {
        "ده": 10,
        "ده تا": 10,
        "دهتا": 10,
        "پنج": 5,
        "پنج تا": 5,
        "بیست": 20,
        "پانزده": 15,
        "سه": 3,
    }
    for word, n in word_map.items():
        if word in text:
            return max(1, min(n, 20))
    m = re.search(r"(?:top\s*)?(\d{1,2})\s*(?:تا|لید|نفر|مورد|تا از)?", text)
    if m:
        return max(1, min(int(m.group(1)), 20))
    return max(1, min(int(default or TOP_N), 20))


def detect_analytics_intents(message: str) -> list[str]:
    """Return up to 2 analytics intent keys from Persian/English phrases."""
    text = (message or "").strip().lower()
    if not text:
        return []
    text = text.replace("ي", "ی").replace("ك", "ک")
    found: list[str] = []
    for intent, phrases in _INTENT_PHRASES:
        if intent in found:
            continue
        for p in phrases:
            needle = p.lower().replace("ي", "ی").replace("ك", "ک")
            if needle in text:
                found.append(intent)
                break
        if len(found) >= 2:
            break

    # Heuristic: buy likelihood → hot_today
    if INTENT_HOT_TODAY not in found:
        has_buy = any(
            w in text
            for w in ("خرید", "بخر", "پتانسیل", "امروز", "داغ", "آماده", "احتمال")
        )
        has_who = any(w in text for w in ("کی", "کدام", "کدوم", "لید", "مشتری", "چه کسی", "کیا"))
        if has_buy and has_who:
            found.append(INTENT_HOT_TODAY)

    # Risk heuristic
    if INTENT_RISK not in found and len(found) < 2:
        if any(w in text for w in ("ریسک", "مداخله", "شکایت", "از دست")):
            found.append(INTENT_RISK)

    # Tasks heuristic
    if INTENT_TASKS_COMPLETED not in found and len(found) < 2:
        if any(w in text for w in ("تسک", "وظیفه", "وظایف")) and any(
            w in text for w in ("کارمند", "اپراتور", "بیشتر", "رتبه", "کی")
        ):
            found.append(INTENT_TASKS_COMPLETED)

    # Playbook heuristic — suggestions + conversation analysis
    if INTENT_LEAD_PLAYBOOK not in found and len(found) < 2:
        has_suggest = any(w in text for w in ("پیشنهاد", "اقدام", "چیکار", "چه کار"))
        has_chat = any(w in text for w in ("گفتگو", "مکالمه", "آنالیز", "انالیز", "تحلیل"))
        if has_suggest and has_chat:
            found.append(INTENT_LEAD_PLAYBOOK)

    return found[:2]


def looks_analytical(message: str) -> bool:
    """True when the message likely needs CRM analytics (for LLM classifier fallback)."""
    text = (message or "").strip().lower().replace("ي", "ی").replace("ك", "ک")
    if not text:
        return False
    cues = (
        "لید",
        "داغ",
        "فروش",
        "اپراتور",
        "کارمند",
        "تسک",
        "وظیفه",
        "رتبه",
        "برتر",
        "بیشتر",
        "کیا",
        "کدوم",
        "کدام",
        "پیشنهاد",
        "گفتگو",
        "آنالیز",
        "انالیز",
        "ریسک",
        "خرید",
        "hot",
        "top",
        "task",
        "lead",
    )
    return any(c in text for c in cues)


def classify_analytics_intents_llm(db: Session, message: str) -> tuple[list[str], int]:
    """Optional LLM JSON classifier when phrase matching finds nothing."""
    try:
        from app.services.ai_reply import generate_llm_text, get_platform_ai_settings

        platform = get_platform_ai_settings(db)
        kinds = ", ".join(sorted(ANALYTICS_KINDS))
        system = (
            "You classify CRM coach questions. Reply ONLY with compact JSON: "
            '{"intents":["hot_today"],"limit":10}. '
            f"Allowed intents: {kinds}. Max 2 intents. limit 1-20."
        )
        user = f"Message:\n{(message or '').strip()[:500]}"
        result = generate_llm_text(platform, system_prompt=system, user_prompt=user, temperature=0.0)
        raw = (result.get("reply") or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
        data = json.loads(raw)
        intents = [
            str(x).strip()
            for x in (data.get("intents") or [])
            if str(x).strip() in ANALYTICS_KINDS
        ][:2]
        limit = int(data.get("limit") or TOP_N)
        limit = max(1, min(limit, 20))
        return intents, limit
    except Exception:  # noqa: BLE001
        return [], TOP_N


def resolve_analytics_intents(
    db: Session, message: str, *, use_llm_fallback: bool = True
) -> tuple[list[str], int]:
    """Phrase detect first; optional LLM fallback for analytical free-form Persian."""
    limit = parse_requested_limit(message, TOP_N)
    intents = detect_analytics_intents(message)[:2]
    if intents or not use_llm_fallback or not looks_analytical(message):
        return intents, limit
    llm_intents, llm_limit = classify_analytics_intents_llm(db, message)
    if llm_intents:
        return llm_intents, llm_limit or limit
    return intents, limit


def _user_label(db: Session, user_id: str | None) -> str:
    if not user_id:
        return "بدون مسئول"
    u = db.get(User, user_id)
    if not u:
        return f"کاربر ({user_id[:8]})"
    name = (u.display_name or "").strip()
    if name:
        return name
    phone = (getattr(u, "phone", None) or "").strip()
    return phone or f"کاربر ({user_id[:8]})"


def _since_days(days: int) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


def _since_hours(hours: int) -> datetime:
    return datetime.utcnow() - timedelta(hours=hours)


def rank_top_sellers(
    db: Session, org_id: str, *, limit: int = TOP_N, days: int = SALES_DAYS
) -> list[dict[str, Any]]:
    """Assignees by count of leads in خرید within window."""
    if not org_id:
        return []
    since = _since_days(days)
    rows = (
        db.query(Lead.assignee_id, func.count(Lead.id))
        .filter(
            Lead.org_id == org_id,
            Lead.stage == CLOSED_STAGE,
            Lead.updated_at >= since,
        )
        .group_by(Lead.assignee_id)
        .order_by(func.count(Lead.id).desc())
        .limit(max(1, min(int(limit or TOP_N), 20)))
        .all()
    )
    out: list[dict[str, Any]] = []
    for assignee_id, count in rows:
        out.append(
            {
                "assignee_id": assignee_id,
                "name": _user_label(db, assignee_id),
                "closed_deals": int(count or 0),
                "window_days": days,
            }
        )
    return out


def rank_top_operators(
    db: Session, org_id: str, *, limit: int = TOP_N
) -> list[dict[str, Any]]:
    """Weighted: closed deals (30d) + outbound agent msgs (7d) + tasks done (7d)."""
    if not org_id:
        return []
    since_sales = _since_days(SALES_DAYS)
    since_act = _since_days(ACTIVITY_DAYS)

    closed_map: dict[str | None, int] = {
        aid: int(c or 0)
        for aid, c in (
            db.query(Lead.assignee_id, func.count(Lead.id))
            .filter(
                Lead.org_id == org_id,
                Lead.stage == CLOSED_STAGE,
                Lead.updated_at >= since_sales,
            )
            .group_by(Lead.assignee_id)
            .all()
        )
    }

    msg_map: dict[str | None, int] = {
        aid: int(c or 0)
        for aid, c in (
            db.query(Message.agent_id, func.count(Message.id))
            .filter(
                Message.org_id == org_id,
                Message.direction == MessageDirection.outbound,
                Message.sender_type == SenderType.agent,
                Message.agent_id.isnot(None),
                Message.created_at >= since_act,
            )
            .group_by(Message.agent_id)
            .all()
        )
    }

    task_map: dict[str | None, int] = {
        aid: int(c or 0)
        for aid, c in (
            db.query(Task.assignee_id, func.count(Task.id))
            .filter(
                Task.org_id == org_id,
                Task.status == TaskStatus.done,
                Task.assignee_id.isnot(None),
                Task.updated_at >= since_act,
            )
            .group_by(Task.assignee_id)
            .all()
        )
    }

    ids = set(closed_map) | set(msg_map) | set(task_map)
    ranked: list[dict[str, Any]] = []
    for aid in ids:
        if aid is None:
            continue
        closed = closed_map.get(aid, 0)
        msgs = msg_map.get(aid, 0)
        tasks = task_map.get(aid, 0)
        score = closed * 10.0 + msgs * 1.0 + tasks * 3.0
        if score <= 0:
            continue
        ranked.append(
            {
                "assignee_id": aid,
                "name": _user_label(db, aid),
                "score": round(score, 1),
                "closed_deals_30d": closed,
                "outbound_msgs_7d": msgs,
                "tasks_done_7d": tasks,
            }
        )
    ranked.sort(key=lambda r: (-r["score"], -r["closed_deals_30d"], r["name"]))
    return ranked[: max(1, min(int(limit or TOP_N), 20))]


def rank_tasks_by_assignee(
    db: Session, org_id: str, *, limit: int = TOP_N, days: int = ACTIVITY_DAYS
) -> list[dict[str, Any]]:
    """Rank staff by completed tasks; include open/overdue counts."""
    if not org_id:
        return []
    since = _since_days(days)
    now = datetime.utcnow()
    done_map: dict[str | None, int] = {
        aid: int(c or 0)
        for aid, c in (
            db.query(Task.assignee_id, func.count(Task.id))
            .filter(
                Task.org_id == org_id,
                Task.status == TaskStatus.done,
                Task.assignee_id.isnot(None),
                Task.updated_at >= since,
            )
            .group_by(Task.assignee_id)
            .all()
        )
    }
    open_map: dict[str | None, int] = {
        aid: int(c or 0)
        for aid, c in (
            db.query(Task.assignee_id, func.count(Task.id))
            .filter(
                Task.org_id == org_id,
                Task.status.in_([TaskStatus.open, TaskStatus.in_progress]),
                Task.assignee_id.isnot(None),
            )
            .group_by(Task.assignee_id)
            .all()
        )
    }
    overdue_map: dict[str | None, int] = {
        aid: int(c or 0)
        for aid, c in (
            db.query(Task.assignee_id, func.count(Task.id))
            .filter(
                Task.org_id == org_id,
                Task.status.in_([TaskStatus.open, TaskStatus.in_progress]),
                Task.assignee_id.isnot(None),
                Task.due_at.isnot(None),
                Task.due_at < now,
            )
            .group_by(Task.assignee_id)
            .all()
        )
    }
    ids = {aid for aid in (set(done_map) | set(open_map) | set(overdue_map)) if aid}
    ranked: list[dict[str, Any]] = []
    for aid in ids:
        done = done_map.get(aid, 0)
        open_n = open_map.get(aid, 0)
        overdue = overdue_map.get(aid, 0)
        ranked.append(
            {
                "assignee_id": aid,
                "name": _user_label(db, aid),
                "tasks_done": done,
                "tasks_open": open_n,
                "tasks_overdue": overdue,
                "window_days": days,
            }
        )
    ranked.sort(key=lambda r: (-r["tasks_done"], -r["tasks_open"], r["name"]))
    # Include people with open work even if done=0 so coach can answer
    if not any(r["tasks_done"] > 0 for r in ranked):
        ranked.sort(key=lambda r: (-r["tasks_open"], r["tasks_overdue"], r["name"]))
    return ranked[: max(1, min(int(limit or TOP_N), 20))]


def rank_top_buyers(
    db: Session, org_id: str, *, limit: int = TOP_N
) -> list[dict[str, Any]]:
    """Leads in خرید by lead_score then updated_at."""
    if not org_id:
        return []
    rows = (
        db.query(Lead)
        .filter(Lead.org_id == org_id, Lead.stage == CLOSED_STAGE)
        .order_by(Lead.lead_score.desc(), Lead.updated_at.desc())
        .limit(max(1, min(int(limit or TOP_N), 20)))
        .all()
    )
    out: list[dict[str, Any]] = []
    for lead in rows:
        out.append(
            {
                "lead_id": lead.id,
                "name": (lead.name or "").strip() or "بدون نام",
                "phone": (lead.phone or "").strip(),
                "lead_score": float(lead.lead_score or 0),
                "stage": lead.stage,
                "assignee": _user_label(db, lead.assignee_id),
                "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
            }
        )
    return out


def rank_hot_leads_today(
    db: Session, org_id: str, *, limit: int = TOP_N, hours: int = HOT_HOURS
) -> list[dict[str, Any]]:
    """Open-funnel leads ranked by score, conversation activity, tags, recency."""
    if not org_id:
        return []
    since_24h = _since_hours(hours)
    since_7d = _since_days(ACTIVITY_DAYS)
    candidates = (
        db.query(Lead)
        .filter(
            Lead.org_id == org_id,
            Lead.stage.in_(OPEN_FUNNEL_STAGES),
        )
        .all()
    )
    if not candidates:
        candidates = (
            db.query(Lead)
            .filter(
                Lead.org_id == org_id,
                Lead.stage.notin_(("خرید", "بسته", "از دست رفته")),
            )
            .all()
        )
    if not candidates:
        return []

    lead_ids = [l.id for l in candidates]
    inbound_24h: dict[str, int] = {lid: 0 for lid in lead_ids}
    msgs_7d: dict[str, int] = {lid: 0 for lid in lead_ids}
    last_inbound: dict[str, str] = {}

    if lead_ids:
        for lid, c in (
            db.query(Message.lead_id, func.count(Message.id))
            .filter(
                Message.org_id == org_id,
                Message.lead_id.in_(lead_ids),
                Message.direction == MessageDirection.inbound,
                Message.created_at >= since_24h,
            )
            .group_by(Message.lead_id)
            .all()
        ):
            inbound_24h[str(lid)] = int(c or 0)

        for lid, c in (
            db.query(Message.lead_id, func.count(Message.id))
            .filter(
                Message.org_id == org_id,
                Message.lead_id.in_(lead_ids),
                Message.created_at >= since_7d,
            )
            .group_by(Message.lead_id)
            .all()
        ):
            msgs_7d[str(lid)] = int(c or 0)

        recent_msgs = (
            db.query(Message)
            .filter(
                Message.org_id == org_id,
                Message.lead_id.in_(lead_ids),
                Message.direction == MessageDirection.inbound,
            )
            .order_by(Message.created_at.desc())
            .limit(min(400, len(lead_ids) * 3))
            .all()
        )
        for m in recent_msgs:
            lid = str(m.lead_id)
            if lid in last_inbound:
                continue
            body = (m.body or "").strip().replace("\n", " ")
            if body:
                last_inbound[lid] = body[:120]

    HOT_TAGS = frozenset({"ready_to_buy", "high_intent", "qualified", "follow_up"})
    scored: list[dict[str, Any]] = []
    now = datetime.utcnow()
    for lead in candidates:
        meta = lead.ai_meta if isinstance(lead.ai_meta, dict) else {}
        sentiment = str(meta.get("sentiment") or "").lower().strip()
        tags = {str(t).lower() for t in (lead.tags or [])}
        in24 = inbound_24h.get(lead.id, 0)
        m7 = msgs_7d.get(lead.id, 0)
        base = float(lead.lead_score or 0)
        tag_boost = 12.0 if tags.intersection(HOT_TAGS) else 0.0
        sent_boost = 5.0 if sentiment == "positive" else (-8.0 if sentiment == "negative" else 0.0)
        paused_pen = -15.0 if lead.bot_paused else 0.0
        recency = 0.0
        ref = lead.last_message_at or lead.updated_at
        if ref:
            age_h = max(0.0, (now - ref).total_seconds() / 3600.0)
            if age_h <= 24:
                recency = 15.0 - age_h * 0.4
            elif age_h <= 72:
                recency = 6.0
            elif age_h <= 168:
                recency = 2.0
        hot = base + in24 * 10.0 + m7 * 1.5 + tag_boost + sent_boost + paused_pen + recency
        scored.append(
            {
                "lead_id": lead.id,
                "name": (lead.name or "").strip() or "بدون نام",
                "phone": (lead.phone or "").strip(),
                "stage": lead.stage or "—",
                "lead_score": base,
                "inbound_24h": in24,
                "msgs_7d": m7,
                "sentiment": sentiment or "—",
                "tags": sorted(tags.intersection(HOT_TAGS)),
                "last_inbound": last_inbound.get(lead.id, ""),
                "bot_paused": bool(lead.bot_paused),
                "hot_score": round(hot, 1),
                "assignee": _user_label(db, lead.assignee_id),
            }
        )
    scored.sort(
        key=lambda r: (
            -r["hot_score"],
            -r["inbound_24h"],
            -r["msgs_7d"],
            -r["lead_score"],
            r["name"],
        )
    )
    return scored[: max(1, min(int(limit or TOP_N), 20))]


RISK_TAGS = frozenset({"churn_risk", "needs_human", "complaint", "detractor", "handoff"})


def rank_risk_leads(db: Session, org_id: str, *, limit: int = TOP_N) -> list[dict[str, Any]]:
    """Leads needing human help or at churn/complaint risk."""
    if not org_id:
        return []
    leads = db.query(Lead).filter(Lead.org_id == org_id).limit(800).all()
    rows: list[dict[str, Any]] = []
    for lead in leads:
        if lead.stage in ("خرید", "بسته", "از دست رفته"):
            tags = {str(t).lower() for t in (lead.tags or [])}
            meta = lead.ai_meta if isinstance(lead.ai_meta, dict) else {}
            if not (
                tags.intersection(RISK_TAGS)
                or meta.get("escalation")
                or str(meta.get("sentiment") or "").lower() == "negative"
            ):
                continue
        tags = {str(t).lower() for t in (lead.tags or [])}
        meta = lead.ai_meta if isinstance(lead.ai_meta, dict) else {}
        sentiment = str(meta.get("sentiment") or "").lower().strip()
        reasons: list[str] = []
        hit_tags = sorted(tags.intersection(RISK_TAGS))
        if hit_tags:
            reasons.extend(hit_tags)
        if meta.get("escalation"):
            reasons.append("escalation")
        if sentiment == "negative":
            reasons.append("sentiment:negative")
        if lead.bot_paused:
            reasons.append("ربات متوقف")
        if not reasons:
            continue
        rows.append(
            {
                "lead_id": lead.id,
                "name": (lead.name or "").strip() or "بدون نام",
                "phone": (lead.phone or "").strip(),
                "stage": lead.stage or "—",
                "lead_score": float(lead.lead_score or 0),
                "reasons": reasons,
                "assignee": _user_label(db, lead.assignee_id),
            }
        )
    rows.sort(key=lambda r: (-len(r["reasons"]), -r["lead_score"], r["name"]))
    return rows[: max(1, min(int(limit or TOP_N), 20))]


def rank_open_leads(db: Session, org_id: str, *, limit: int = TOP_N) -> list[dict[str, Any]]:
    """Open-funnel leads (پیگیری/پیشنهاد/جدید)."""
    if not org_id:
        return []
    rows = (
        db.query(Lead)
        .filter(Lead.org_id == org_id, Lead.stage.in_(OPEN_FUNNEL_STAGES))
        .order_by(Lead.lead_score.desc(), Lead.updated_at.desc())
        .limit(max(1, min(int(limit or TOP_N), 20)))
        .all()
    )
    out: list[dict[str, Any]] = []
    for lead in rows:
        out.append(
            {
                "lead_id": lead.id,
                "name": (lead.name or "").strip() or "بدون نام",
                "phone": (lead.phone or "").strip(),
                "stage": lead.stage or "—",
                "lead_score": float(lead.lead_score or 0),
                "assignee": _user_label(db, lead.assignee_id),
                "note": "در CRM مرحله «در حال مذاکره» نداریم؛ معادل: پیگیری / پیشنهاد / جدید",
            }
        )
    return out


def _suggest_next_action(last_customer: str, stage: str, tags: list[str]) -> str:
    """Rule-based playbook suggestion from last customer message + stage."""
    body = (last_customer or "").lower()
    tagset = {str(t).lower() for t in (tags or [])}
    if any(w in body for w in ("بازدید", "میام", "ببینم", "هماهنگ")):
        return "هماهنگی بازدید حضوری امروز/فردا"
    if any(w in body for w in ("وام", "بانک", "اقساط")):
        return "پیگیری مدارک وام و ارسال چک‌لیست بانکی"
    if any(w in body for w in ("قیمت", "تخفیف", "نهایی", "میلیارد", "رهن")):
        return "ارسال پیشنهاد قیمت شفاف با ۲ گزینه جایگزین"
    if any(w in body for w in ("عکس", "فایل", "پلان", "ویدیو")):
        return "ارسال پکیج فایل (عکس + پلان + مشخصات)"
    if any(w in body for w in ("قولنامه", "قرارداد", "مبایعه‌نامه", "مبایعه")):
        return "تنظیم پیش‌نویس قرارداد و هماهنگی جلسه امضا"
    if tagset.intersection({"ready_to_buy", "high_intent"}):
        return "تماس فوری فروش — قصد خرید بالاست"
    if stage == "جدید":
        return "تماس اولیه + معرفی ۲ فایل مناسب بودجه"
    if stage == "پیگیری":
        return "پیگیری نوبت بعدی با خلاصه مزایای ملک"
    if stage == "پیشنهاد":
        return "بستن پیشنهاد نهایی و تعیین مهلت پاسخ"
    if stage == "خرید":
        return "هماهنگی مدارک و زمان تحویل"
    return "پیگیری دوستانه و پرسش نیاز باقی‌مانده"


def build_lead_playbook(
    db: Session, org_id: str, *, limit: int = TOP_N, msg_limit: int = PLAYBOOK_MSG_LIMIT
) -> list[dict[str, Any]]:
    """Hot leads + recent conversation snippets + next-action suggestions."""
    hot = rank_hot_leads_today(db, org_id, limit=limit)
    if not hot:
        return []
    out: list[dict[str, Any]] = []
    for row in hot:
        lead_id = row["lead_id"]
        lead = db.get(Lead, lead_id)
        msgs = (
            db.query(Message)
            .filter(Message.org_id == org_id, Message.lead_id == lead_id)
            .order_by(Message.created_at.desc())
            .limit(max(1, min(int(msg_limit or PLAYBOOK_MSG_LIMIT), 20)))
            .all()
        )
        msgs = list(reversed(msgs))
        thread: list[str] = []
        last_customer = ""
        for m in msgs:
            who = "مشتری" if m.direction == MessageDirection.inbound else (
                "AI" if m.sender_type == SenderType.ai else "کارشناس"
            )
            body = (m.body or "").strip().replace("\n", " ")[:160]
            if not body:
                continue
            thread.append(f"{who}: {body}")
            if m.direction == MessageDirection.inbound:
                last_customer = body
        tags = list(lead.tags or []) if lead else list(row.get("tags") or [])
        stage = (lead.stage if lead else None) or row.get("stage") or "—"
        suggestion = _suggest_next_action(last_customer, stage, tags)
        out.append(
            {
                **row,
                "suggestion": suggestion,
                "recent_messages": thread[-msg_limit:],
                "last_customer": last_customer,
            }
        )
    return out


def run_analytics(
    db: Session, org_id: str, intents: list[str], *, limit: int = TOP_N
) -> dict[str, list[dict[str, Any]]]:
    """Run requested rankers (unknown keys skipped). Always org-scoped."""
    out: dict[str, list[dict[str, Any]]] = {}
    for intent in intents:
        if intent not in ANALYTICS_KINDS:
            continue
        if intent == INTENT_TOP_SELLER:
            out[intent] = rank_top_sellers(db, org_id, limit=limit)
        elif intent == INTENT_TOP_OPERATOR:
            out[intent] = rank_top_operators(db, org_id, limit=limit)
        elif intent == INTENT_TOP_BUYER:
            out[intent] = rank_top_buyers(db, org_id, limit=limit)
        elif intent == INTENT_HOT_TODAY:
            out[intent] = rank_hot_leads_today(db, org_id, limit=limit)
        elif intent == INTENT_RISK:
            out[intent] = rank_risk_leads(db, org_id, limit=limit)
        elif intent == INTENT_OPEN_LEADS:
            out[intent] = rank_open_leads(db, org_id, limit=limit)
        elif intent == INTENT_TASKS_COMPLETED:
            out[intent] = rank_tasks_by_assignee(db, org_id, limit=limit)
        elif intent == INTENT_LEAD_PLAYBOOK:
            out[intent] = build_lead_playbook(db, org_id, limit=limit)
    return out


def format_analytics_report(results: dict[str, list[dict[str, Any]]]) -> str:
    """Compact Persian report for coach prompt injection."""
    if not results:
        return ""
    lines: list[str] = [
        "### گزارش تحلیلی (SQL)",
        "فقط از اعداد و نام‌های زیر استفاده کن؛ چیزی جعل نکن.",
        "هرگز نگو «برو کانبان را ببین» — بورد لیدها / صفحه وظایف را فقط در صورت نیاز ذکر کن.",
    ]

    if INTENT_TOP_SELLER in results:
        rows = results[INTENT_TOP_SELLER]
        lines.append("")
        lines.append(f"#### فروشنده برتر (لیدهای «خرید» در {SALES_DAYS} روز اخیر)")
        if not rows:
            lines.append("- داده کافی نیست (لید بسته‌شده با مسئول ثبت نشده).")
        else:
            for i, r in enumerate(rows, 1):
                lines.append(
                    f"- {i}. {r['name']}: {r['closed_deals']} معامله بسته‌شده"
                )

    if INTENT_TOP_OPERATOR in results:
        rows = results[INTENT_TOP_OPERATOR]
        lines.append("")
        lines.append(
            "#### اپراتور کارآمد "
            f"(امتیاز = خرید×۱۰ + پیام خروجی×۱ + وظیفه انجام‌شده×۳؛ "
            f"خرید {SALES_DAYS}روز / فعالیت {ACTIVITY_DAYS}روز)"
        )
        if not rows:
            lines.append("- داده کافی نیست.")
        else:
            for i, r in enumerate(rows, 1):
                lines.append(
                    f"- {i}. {r['name']}: امتیاز {r['score']} "
                    f"(خرید {r['closed_deals_30d']}، پیام {r['outbound_msgs_7d']}، "
                    f"وظیفه {r['tasks_done_7d']})"
                )

    if INTENT_TASKS_COMPLETED in results:
        rows = results[INTENT_TASKS_COMPLETED]
        lines.append("")
        lines.append(
            f"#### رتبه‌بندی انجام وظایف "
            f"(انجام‌شده در {ACTIVITY_DAYS} روز + باز/عقب‌افتاده)"
        )
        if not rows:
            lines.append("- هنوز وظیفه‌ای با مسئول ثبت نشده.")
        else:
            lines.append("نام کارمند با بیشترین تسک انجام‌شده را عیناً بگو.")
            for i, r in enumerate(rows, 1):
                lines.append(
                    f"- {i}. {r['name']}: انجام‌شده {r['tasks_done']} · "
                    f"باز {r['tasks_open']} · عقب‌افتاده {r['tasks_overdue']}"
                )

    if INTENT_TOP_BUYER in results:
        rows = results[INTENT_TOP_BUYER]
        lines.append("")
        lines.append("#### خریداران برتر (مرحله خرید، بر اساس امتیاز لید)")
        if not rows:
            lines.append("- هنوز لیدی در مرحله «خرید» نیست.")
        else:
            for i, r in enumerate(rows, 1):
                phone = f" · {r['phone']}" if r.get("phone") else ""
                lines.append(
                    f"- {i}. {r['name']}{phone}: امتیاز {r['lead_score']:.0f} "
                    f"(مسئول: {r['assignee']})"
                )

    if INTENT_HOT_TODAY in results:
        rows = results[INTENT_HOT_TODAY]
        lines.append("")
        lines.append(
            "#### پتانسیل خرید / داغ‌ترین لیدها "
            "(قیف باز + گفتگو؛ نام‌ها را عیناً بگو)"
        )
        if not rows:
            lines.append("- هیچ لید بازی در CRM این سازمان پیدا نشد.")
        else:
            lines.append(f"لیست کامل {len(rows)} نفر برتر را با مرحله و دلیل کوتاه بگو.")
            for i, r in enumerate(rows, 1):
                tags = "، ".join(r.get("tags") or []) or "—"
                snip = (r.get("last_inbound") or "").strip()
                snip_bit = f" · آخرین پیام مشتری: «{snip}»" if snip else ""
                phone = f" · {r['phone']}" if r.get("phone") else ""
                lines.append(
                    f"- {i}. نام: {r['name']}{phone} · مرحله: {r['stage']} · "
                    f"امتیاز لید {r['lead_score']:.0f} · ورودی۲۴س {r['inbound_24h']} · "
                    f"پیام۷روز {r.get('msgs_7d', 0)} · تگ: {tags} · "
                    f"hot {r['hot_score']} · مسئول: {r['assignee']}{snip_bit}"
                )

    if INTENT_LEAD_PLAYBOOK in results:
        rows = results[INTENT_LEAD_PLAYBOOK]
        lines.append("")
        lines.append(
            "#### پیشنهاد اقدام بر اساس گفتگو (playbook) "
            "— برای هر لید پیشنهاد و خلاصه پیام‌ها را بگو"
        )
        if not rows:
            lines.append("- داده کافی برای پیشنهاد اقدام نیست.")
        else:
            for i, r in enumerate(rows, 1):
                phone = f" · {r['phone']}" if r.get("phone") else ""
                lines.append(
                    f"- {i}. {r['name']}{phone} · {r['stage']} · hot {r.get('hot_score', 0)} · "
                    f"پیشنهاد: {r.get('suggestion') or '—'}"
                )
                thread = r.get("recent_messages") or []
                if thread:
                    lines.append("  گفتگوی اخیر:")
                    for line in thread[-6:]:
                        lines.append(f"  · {line}")

    if INTENT_RISK in results:
        rows = results[INTENT_RISK]
        lines.append("")
        lines.append("#### لیدهای نیازمند مداخله انسانی / ریسک از دست رفتن")
        if not rows:
            lines.append("- لید پرریسک با تگ/احساس منفی در داده‌ها نیست.")
        else:
            lines.append("نام‌ها را عیناً بگو و دلیل ریسک را ذکر کن.")
            for i, r in enumerate(rows, 1):
                phone = f" · {r['phone']}" if r.get("phone") else ""
                reasons = "، ".join(r.get("reasons") or []) or "—"
                lines.append(
                    f"- {i}. نام: {r['name']}{phone} · مرحله: {r['stage']} · "
                    f"دلیل: {reasons} · مسئول: {r['assignee']}"
                )

    if INTENT_OPEN_LEADS in results:
        rows = results[INTENT_OPEN_LEADS]
        lines.append("")
        lines.append(
            "#### لیدهای باز / «در حال مذاکره» "
            "(مراحل واقعی CRM: جدید، پیگیری، پیشنهاد — نه کانبان)"
        )
        if not rows:
            lines.append("- لید بازی در قیف فروش نیست.")
        else:
            lines.append("این نام‌ها را لیست کن؛ به صفحه وظایف فقط برای follow-up اشاره کن.")
            for i, r in enumerate(rows, 1):
                phone = f" · {r['phone']}" if r.get("phone") else ""
                lines.append(
                    f"- {i}. نام: {r['name']}{phone} · مرحله: {r['stage']} · "
                    f"امتیاز {r['lead_score']:.0f} · مسئول: {r['assignee']}"
                )

    return "\n".join(lines)


def lead_snapshot_for_context(db: Session, org_id: str, *, limit: int = 8) -> str:
    """Always-on named lead lists so coach never claims CRM has no lead list."""
    if not org_id:
        return ""
    hot = rank_hot_leads_today(db, org_id, limit=limit)
    risk = rank_risk_leads(db, org_id, limit=min(5, limit))
    open_rows = rank_open_leads(db, org_id, limit=limit)
    lines = ["### لیدهای واقعی این سازمان (از دیتابیس)"]
    if open_rows:
        lines.append("لیدهای باز:")
        for r in open_rows:
            lines.append(f"- {r['name']} · {r['stage']} · امتیاز {r['lead_score']:.0f}")
    else:
        lines.append("لیدهای باز: هیچ")
    if hot:
        lines.append("بالاترین پتانسیل (رتبه‌بندی):")
        for r in hot[:5]:
            lines.append(
                f"- {r['name']} · {r['stage']} · hot {r['hot_score']} · "
                f"ورودی۲۴س {r['inbound_24h']}"
            )
    if risk:
        lines.append("نیازمند توجه / ریسک:")
        for r in risk:
            lines.append(f"- {r['name']} · {r['stage']} · {', '.join(r['reasons'])}")
    else:
        lines.append("نیازمند توجه / ریسک: موردی ثبت نشده")
    lines.append(
        "اگر کاربر نام لید خواست، از همین لیست بگو. "
        "به جای «کانبان» بگو بورد لیدها یا صفحه وظایف."
    )
    return "\n".join(lines)


def analytics_for_message(
    db: Session, org_id: str, message: str, *, use_llm_fallback: bool = True
) -> str:
    """Detect intents (max 2), run tools, return formatted report or empty string."""
    intents, limit = resolve_analytics_intents(
        db, message, use_llm_fallback=use_llm_fallback
    )
    if not intents:
        return ""
    results = run_analytics(db, org_id, intents, limit=limit)
    return format_analytics_report(results)
