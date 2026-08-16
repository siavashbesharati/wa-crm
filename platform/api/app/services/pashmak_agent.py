"""آقای میوژن agent tools — mutations and briefs, always org-scoped.

Hard multi-tenant rule: every public function requires org_id and only reads/writes
rows with that org_id. Lead/user lookups never cross organizations. No WhatsApp send.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    ChannelAccount,
    Lead,
    Membership,
    Message,
    MessageDirection,
    Task,
    TaskStatus,
    User,
)
from app.services.crm_taxonomy import FUNNEL_STAGES, normalize_stage
from app.services.org_analytics import (
    rank_hot_leads_today,
    rank_open_leads,
    rank_risk_leads,
    rank_top_operators,
)

logger = logging.getLogger("pashmak_agent")

# Imperative verbs → allow mutation without extra confirm phrase
_MUTATE_VERBS = (
    "بساز",
    "بسازید",
    "ثبت کن",
    "ثبت کنید",
    "انجام بده",
    "انجام بدهید",
    "اختصاص بده",
    "واگذار کن",
    "تغییر بده",
    "بزن",
    "ایجاد کن",
)

ACTION_BRIEF = "brief"
ACTION_CREATE_TASK = "create_task"
ACTION_ASSIGN = "assign_lead"
ACTION_SET_STAGE = "set_stage"
ACTION_DRAFT = "draft_followup"
ACTION_PAUSE_BOT = "pause_bot"

AGENT_ACTIONS = frozenset(
    {
        ACTION_BRIEF,
        ACTION_CREATE_TASK,
        ACTION_ASSIGN,
        ACTION_SET_STAGE,
        ACTION_DRAFT,
        ACTION_PAUSE_BOT,
    }
)


class TenantIsolationError(ValueError):
    """Raised when org scope is missing or a cross-tenant access is attempted."""


def _require_org_id(org_id: str | None) -> str:
    oid = (org_id or "").strip()
    if not oid:
        raise TenantIsolationError("org_id لازم است — بدون سازمان اقدامی مجاز نیست")
    return oid


def _normalize(text: str) -> str:
    return (text or "").strip().lower().replace("ي", "ی").replace("ك", "ک")


def get_org_lead(db: Session, org_id: str, lead_id: str) -> Lead | None:
    """Fetch lead only if it belongs to org_id."""
    oid = _require_org_id(org_id)
    lid = (lead_id or "").strip()
    if not lid:
        return None
    return db.query(Lead).filter(Lead.id == lid, Lead.org_id == oid).first()


def find_org_leads_by_name(db: Session, org_id: str, name: str, *, limit: int = 5) -> list[Lead]:
    """Name search strictly inside one org (never global)."""
    oid = _require_org_id(org_id)
    q = (name or "").strip()
    if len(q) < 2:
        return []
    rows = (
        db.query(Lead)
        .filter(Lead.org_id == oid, Lead.name.ilike(f"%{q}%"))
        .order_by(Lead.updated_at.desc())
        .limit(max(1, min(limit, 20)))
        .all()
    )
    return rows


def resolve_org_member(db: Session, org_id: str, name_or_id: str) -> User | None:
    """Resolve a teammate only if they have Membership in this org."""
    oid = _require_org_id(org_id)
    raw = (name_or_id or "").strip()
    if not raw:
        return None

    member_ids = [
        m.user_id
        for m in db.query(Membership).filter(Membership.org_id == oid).all()
    ]
    if not member_ids:
        return None

    if raw in member_ids:
        return db.get(User, raw)

    needle = _normalize(raw)
    users = db.query(User).filter(User.id.in_(member_ids)).all()
    for u in users:
        dn = _normalize(u.display_name or "")
        ph = _normalize(getattr(u, "phone", None) or "")
        if needle and (needle == dn or needle in dn or (ph and needle in ph)):
            return u
    return None


def build_morning_brief(db: Session, org_id: str) -> dict[str, Any]:
    """Org-only morning brief: hot, risk, open tasks, channel health."""
    oid = _require_org_id(org_id)
    hot = rank_hot_leads_today(db, oid, limit=5)
    risk = rank_risk_leads(db, oid, limit=5)
    open_leads = rank_open_leads(db, oid, limit=5)
    ops = rank_top_operators(db, oid, limit=3)

    open_tasks = (
        db.query(Task)
        .filter(
            Task.org_id == oid,
            Task.status.in_((TaskStatus.open, TaskStatus.in_progress)),
        )
        .all()
    )
    open_tasks.sort(
        key=lambda t: (
            0 if t.due_at else 1,
            t.due_at or datetime.max,
            -(t.updated_at.timestamp() if t.updated_at else 0),
        )
    )
    open_tasks = open_tasks[:8]
    overdue = 0
    now = datetime.utcnow()
    task_rows = []
    for t in open_tasks:
        is_over = bool(t.due_at and t.due_at < now)
        if is_over:
            overdue += 1
        lead_name = ""
        if t.lead_id:
            lead = get_org_lead(db, oid, t.lead_id)
            lead_name = (lead.name if lead else "") or ""
        task_rows.append(
            {
                "id": t.id,
                "title": t.title or "",
                "lead_name": lead_name,
                "due_at": t.due_at.isoformat() if t.due_at else None,
                "overdue": is_over,
            }
        )

    channels = db.query(ChannelAccount).filter(ChannelAccount.org_id == oid).all()
    channel_rows = [
        {
            "id": c.id,
            "label": (c.label or c.external_id or c.id)[:80],
            "provider": str(getattr(c.channel, "value", c.channel) or ""),
            "status": c.pairing_state or c.status or "",
        }
        for c in channels
    ]

    return {
        "org_id": oid,
        "generated_at": now.isoformat() + "Z",
        "hot_leads": hot,
        "risk_leads": risk,
        "open_leads": open_leads,
        "top_operators": ops,
        "open_tasks": task_rows,
        "tasks_overdue": overdue,
        "channels": channel_rows,
    }


def format_brief_report(brief: dict[str, Any]) -> str:
    lines = [
        "### گزارش عامل — بریفینگ امروز",
        f"(فقط سازمان `{brief.get('org_id', '')}` — بدون داده کسب‌وکار دیگر)",
    ]
    hot = brief.get("hot_leads") or []
    risk = brief.get("risk_leads") or []
    tasks = brief.get("open_tasks") or []
    lines.append("")
    lines.append("#### داغ‌ترین لیدها")
    if not hot:
        lines.append("- موردی نیست")
    else:
        for i, r in enumerate(hot, 1):
            lines.append(f"- {i}. {r.get('name')} · {r.get('stage')} · hot {r.get('hot_score')}")

    lines.append("")
    lines.append("#### ریسک / مداخله انسانی")
    if not risk:
        lines.append("- موردی ثبت نشده")
    else:
        for i, r in enumerate(risk, 1):
            reasons = "، ".join(r.get("reasons") or [])
            lines.append(f"- {i}. {r.get('name')} · {r.get('stage')} · {reasons}")

    lines.append("")
    lines.append(f"#### وظایف باز (عقب‌افتاده: {brief.get('tasks_overdue', 0)})")
    if not tasks:
        lines.append("- وظیفه بازی نیست")
    else:
        for t in tasks:
            flag = " ⚠ عقب‌افتاده" if t.get("overdue") else ""
            lead = f" · لید: {t['lead_name']}" if t.get("lead_name") else ""
            lines.append(f"- {t.get('title') or 'بدون عنوان'}{lead}{flag}")

    ch = brief.get("channels") or []
    lines.append("")
    lines.append("#### کانال‌ها")
    if not ch:
        lines.append("- کانالی ثبت نشده")
    else:
        for c in ch:
            lines.append(f"- {c.get('label')} ({c.get('provider')}): {c.get('status') or '—'}")

    lines.append("")
    lines.append("نام‌ها را از همین گزارش بگو؛ به کسب‌وکار دیگر اشاره نکن.")
    return "\n".join(lines)


def create_followup_task(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    title: str,
    message: str = "",
    created_by_id: str | None = None,
) -> dict[str, Any]:
    oid = _require_org_id(org_id)
    lead = get_org_lead(db, oid, lead_id)
    if not lead:
        return {"ok": False, "error": "لید در این سازمان پیدا نشد"}
    from app.services.contact_tasks import create_task_for_contact

    task = create_task_for_contact(
        db,
        org_id=oid,
        lead_id=lead.id,
        title=(title or f"پیگیری {lead.name}").strip()[:200],
        message=(message or "").strip(),
        created_by_id=created_by_id,
        source="ai",
        commit=False,
    )
    logger.info("pashmak create_task org=%s lead=%s task=%s", oid, lead.id, task.id)
    return {
        "ok": True,
        "task_id": task.id,
        "lead_id": lead.id,
        "lead_name": lead.name,
        "title": task.title,
    }


def assign_lead(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    assignee_user_id: str | None,
) -> dict[str, Any]:
    oid = _require_org_id(org_id)
    lead = get_org_lead(db, oid, lead_id)
    if not lead:
        return {"ok": False, "error": "لید در این سازمان پیدا نشد"}
    if assignee_user_id:
        member = (
            db.query(Membership)
            .filter(Membership.org_id == oid, Membership.user_id == assignee_user_id)
            .first()
        )
        if not member:
            return {"ok": False, "error": "کاربر عضو این سازمان نیست"}
    lead.assignee_id = assignee_user_id
    lead.updated_at = datetime.utcnow()
    db.add(lead)
    db.flush()
    logger.info("pashmak assign org=%s lead=%s user=%s", oid, lead.id, assignee_user_id)
    return {
        "ok": True,
        "lead_id": lead.id,
        "lead_name": lead.name,
        "assignee_id": assignee_user_id,
    }


def set_lead_stage(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    stage: str,
) -> dict[str, Any]:
    oid = _require_org_id(org_id)
    lead = get_org_lead(db, oid, lead_id)
    if not lead:
        return {"ok": False, "error": "لید در این سازمان پیدا نشد"}
    normalized = normalize_stage(stage) or (stage or "").strip()
    if normalized not in FUNNEL_STAGES and normalized not in ("از دست رفته",):
        return {
            "ok": False,
            "error": f"مرحله نامعتبر است. مجاز: {', '.join(FUNNEL_STAGES)}",
        }
    lead.stage = normalized
    lead.updated_at = datetime.utcnow()
    db.add(lead)
    db.flush()
    logger.info("pashmak set_stage org=%s lead=%s stage=%s", oid, lead.id, normalized)
    return {"ok": True, "lead_id": lead.id, "lead_name": lead.name, "stage": normalized}


def set_bot_paused(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    paused: bool,
) -> dict[str, Any]:
    oid = _require_org_id(org_id)
    lead = get_org_lead(db, oid, lead_id)
    if not lead:
        return {"ok": False, "error": "لید در این سازمان پیدا نشد"}
    lead.bot_paused = bool(paused)
    lead.updated_at = datetime.utcnow()
    db.add(lead)
    db.flush()
    return {
        "ok": True,
        "lead_id": lead.id,
        "lead_name": lead.name,
        "bot_paused": lead.bot_paused,
    }


def draft_followup_for_lead(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
) -> dict[str, Any]:
    """Build context for an internal draft — never sends WhatsApp."""
    oid = _require_org_id(org_id)
    lead = get_org_lead(db, oid, lead_id)
    if not lead:
        return {"ok": False, "error": "لید در این سازمان پیدا نشد"}
    msgs = (
        db.query(Message)
        .filter(Message.org_id == oid, Message.lead_id == lead.id)
        .order_by(Message.created_at.desc())
        .limit(8)
        .all()
    )
    history = []
    for m in reversed(msgs):
        who = "مشتری" if m.direction == MessageDirection.inbound else "تیم"
        history.append(f"{who}: {(m.body or '')[:200]}")
    return {
        "ok": True,
        "lead_id": lead.id,
        "lead_name": lead.name,
        "stage": lead.stage,
        "phone": lead.phone or "",
        "history": history,
        "instruction": (
            "یک پیش‌نویس کوتاه فارسی برای پیگیری این لید بنویس. "
            "ارسال واتساپ نکن؛ فقط متن پیش‌نویس بده."
        ),
    }


def detect_agent_actions(message: str) -> list[str]:
    text = _normalize(message)
    if not text:
        return []
    found: list[str] = []

    brief_keys = ("بریفینگ", "خلاصه امروز", "گزارش امروز", "صبح بخیر", "وضعیت امروز", "morning brief")
    if any(k in text for k in brief_keys):
        found.append(ACTION_BRIEF)

    if any(k in text for k in ("وظیفه بساز", "تسک بساز", "ایجاد وظیفه", "ثبت وظیفه", "task بساز")):
        found.append(ACTION_CREATE_TASK)

    if any(k in text for k in ("اختصاص بده", "واگذار کن", "assign", "مسئول کن")):
        found.append(ACTION_ASSIGN)

    if any(k in text for k in ("مرحله", "stage")) and any(
        k in text for k in ("کن", "بزن", "تغییر", "ببر", "بذار")
    ):
        found.append(ACTION_SET_STAGE)

    if any(k in text for k in ("پیش‌نویس", "پیش نویس", "draft", "متن پیام برای", "پیام بنویس برای")):
        found.append(ACTION_DRAFT)

    if any(k in text for k in ("ربات را متوقف", "توقف ربات", "pause bot", "ربات رو قطع")):
        found.append(ACTION_PAUSE_BOT)

    return found[:2]


def _wants_mutate(message: str) -> bool:
    text = _normalize(message)
    return any(v in text for v in _MUTATE_VERBS)


def _extract_quoted_or_after(text: str, markers: tuple[str, ...]) -> str:
    raw = text or ""
    for m in markers:
        idx = _normalize(raw).find(_normalize(m))
        if idx >= 0:
            # use original slice after marker length (approx)
            # fallback: regex on normalized
            break
    # Try «name» or "name"
    m = re.search(r"[«\"]([^»\"]{2,80})[»\"]", raw)
    if m:
        return m.group(1).strip()
    # برای X / به X
    m2 = re.search(r"(?:برای|به)\s+([^\s،.؟?]{2,40})", raw)
    if m2:
        return m2.group(1).strip()
    return ""


def _pick_lead(db: Session, org_id: str, message: str) -> Lead | None:
    name = _extract_quoted_or_after(message, ("برای", "به"))
    if name:
        hits = find_org_leads_by_name(db, org_id, name, limit=3)
        if len(hits) == 1:
            return hits[0]
        if hits:
            return hits[0]
    # fallback: hottest lead in org if user said "داغ‌ترین"
    if "داغ" in _normalize(message) or "برتر" in _normalize(message):
        hot = rank_hot_leads_today(db, org_id, limit=1)
        if hot:
            return get_org_lead(db, org_id, hot[0]["lead_id"])
    return None


def _extract_stage(message: str) -> str | None:
    text = _normalize(message)
    for st in FUNNEL_STAGES:
        if st in text:
            return st
    if "از دست" in text:
        return "از دست رفته"
    aliases = {
        "جدید": "جدید",
        "پیگیری": "پیگیری",
        "پیشنهاد": "پیشنهاد",
        "خرید": "خرید",
        "بسته": "بسته",
        "مذاکره": "پیگیری",
    }
    for k, v in aliases.items():
        if k in text:
            return v
    return None


def run_agent_for_message(
    db: Session,
    *,
    org_id: str,
    message: str,
    user_id: str | None = None,
) -> str:
    """Detect agent intents and run org-scoped tools. Returns report block or ''."""
    oid = _require_org_id(org_id)
    actions = detect_agent_actions(message)
    if not actions:
        return ""

    blocks: list[str] = [
        "### نتیجه اقدام آقای میوژن (عامل)",
        f"سازمان فعال: `{oid}` — داده کسب‌وکار دیگر استفاده نشد.",
    ]

    for action in actions:
        if action == ACTION_BRIEF:
            brief = build_morning_brief(db, oid)
            blocks.append(format_brief_report(brief))
            continue

        lead = _pick_lead(db, oid, message)
        if action in (
            ACTION_CREATE_TASK,
            ACTION_ASSIGN,
            ACTION_SET_STAGE,
            ACTION_DRAFT,
            ACTION_PAUSE_BOT,
        ) and not lead:
            blocks.append(
                f"- اقدام `{action}`: لید مشخص نشد. نام لید را داخل «» بنویسید یا بگویید برای [نام]."
            )
            continue

        assert lead is not None

        if action == ACTION_CREATE_TASK:
            if not _wants_mutate(message):
                blocks.append(
                    f"- پیشنهاد: وظیفه پیگیری برای «{lead.name}» بسازم؟ بنویسید «بله بساز»."
                )
                continue
            res = create_followup_task(
                db,
                org_id=oid,
                lead_id=lead.id,
                title=f"پیگیری {lead.name}",
                message="ساخته‌شده توسط آقای میوژن",
                created_by_id=user_id,
            )
            blocks.append(
                f"- وظیفه: {'ثبت شد' if res.get('ok') else res.get('error')} "
                f"· لید {res.get('lead_name')} · {res.get('title', '')}"
            )

        elif action == ACTION_ASSIGN:
            # "اختصاص بده X به Y" — second name is assignee
            parts = re.split(r"\s+به\s+", message.strip(), maxsplit=1)
            assignee_raw = parts[1].strip() if len(parts) > 1 else ""
            user = resolve_org_member(db, oid, assignee_raw) if assignee_raw else None
            if not user:
                blocks.append(
                    f"- اختصاص: عضو تیم با نام «{assignee_raw or '?'}» در این سازمان پیدا نشد."
                )
                continue
            if not _wants_mutate(message):
                blocks.append(
                    f"- پیشنهاد: «{lead.name}» به {user.display_name or user.phone} اختصاص داده شود؟"
                )
                continue
            res = assign_lead(db, org_id=oid, lead_id=lead.id, assignee_user_id=user.id)
            blocks.append(
                f"- اختصاص: {'انجام شد' if res.get('ok') else res.get('error')} "
                f"· {lead.name} → {user.display_name or user.phone}"
            )

        elif action == ACTION_SET_STAGE:
            stage = _extract_stage(message)
            if not stage:
                blocks.append("- مرحله نامشخص است (مثلاً پیگیری / پیشنهاد / خرید).")
                continue
            if not _wants_mutate(message):
                blocks.append(f"- پیشنهاد: مرحله «{lead.name}» → {stage}؟ بنویسید «انجام بده».")
                continue
            res = set_lead_stage(db, org_id=oid, lead_id=lead.id, stage=stage)
            blocks.append(
                f"- مرحله: {'به‌روز شد' if res.get('ok') else res.get('error')} "
                f"· {lead.name} → {res.get('stage', stage)}"
            )

        elif action == ACTION_PAUSE_BOT:
            if not _wants_mutate(message):
                blocks.append(f"- پیشنهاد: ربات برای «{lead.name}» متوقف شود؟")
                continue
            res = set_bot_paused(db, org_id=oid, lead_id=lead.id, paused=True)
            blocks.append(
                f"- ربات: {'متوقف شد' if res.get('ok') else res.get('error')} · {lead.name}"
            )

        elif action == ACTION_DRAFT:
            draft = draft_followup_for_lead(db, org_id=oid, lead_id=lead.id)
            if not draft.get("ok"):
                blocks.append(f"- پیش‌نویس: {draft.get('error')}")
                continue
            hist = "\n".join(draft.get("history") or []) or "(بدون پیام)"
            blocks.append(
                f"- پیش‌نویس برای «{draft['lead_name']}» (مرحله {draft.get('stage')}).\n"
                f"  تاریخچه اخیر این سازمان:\n{hist}\n"
                f"  {draft.get('instruction')}\n"
                "  توجه: پیام را به واتساپ نفرست؛ فقط متن پیشنهاد بده."
            )

    return "\n".join(blocks)
