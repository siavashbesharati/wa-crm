"""CRM semantic index for آقای میوژن — derived docs from leads/messages/tasks.

Embeddings stored as JSON (SQLite + Postgres). Upserts are content-hash gated so
unchanged entities skip re-embedding. Retrieval uses cosine similarity scoped by org_id.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    CrmIndexChunk,
    Lead,
    Message,
    MessageDirection,
    Organization,
    SenderType,
    Task,
    TaskStatus,
    User,
)
from app.services.embeddings import content_sha1, cosine, embed_crm_text

logger = logging.getLogger("crm_index")

ENTITY_LEAD = "lead"
ENTITY_CONVERSATION = "conversation"
ENTITY_TASK = "task"
ENTITY_TEAM_SNAPSHOT = "team_snapshot"

ENTITY_TYPES = frozenset(
    {ENTITY_LEAD, ENTITY_CONVERSATION, ENTITY_TASK, ENTITY_TEAM_SNAPSHOT}
)

CONV_MSG_LIMIT = 15
TEAM_SNAPSHOT_ID = "daily"


def org_index_enabled(db: Session, org_id: str) -> bool:
    if not org_id:
        return False
    org = db.get(Organization, org_id)
    if not org:
        return False
    return bool(getattr(org, "crm_index_enabled", True))


def _user_label(db: Session, user_id: str | None) -> str:
    if not user_id:
        return "بدون مسئول"
    u = db.get(User, user_id)
    if not u:
        return "کاربر"
    return (u.display_name or "").strip() or (u.phone or "").strip() or "کاربر"


def build_lead_document(db: Session, lead: Lead) -> str:
    tags = "، ".join(lead.tags or []) or "—"
    meta = lead.ai_meta if isinstance(lead.ai_meta, dict) else {}
    sentiment = str(meta.get("sentiment") or "—")
    memory = ""
    mem = meta.get("memory") if isinstance(meta.get("memory"), dict) else {}
    if mem:
        memory = str(mem.get("summary") or "").strip()
    notes = (lead.notes or "").strip()[:400]
    lines = [
        f"مخاطب: {(lead.name or '').strip() or 'بدون نام'}",
        f"تلفن: {(lead.phone or '').strip() or '—'}",
        f"مرحله: {lead.stage or '—'}",
        f"امتیاز: {float(lead.lead_score or 0):.0f}",
        f"کانال: {lead.source_channel or '—'}",
        f"مسئول: {_user_label(db, lead.assignee_id)}",
        f"تگ‌ها: {tags}",
        f"احساس: {sentiment}",
        f"ربات متوقف: {'بله' if lead.bot_paused else 'خیر'}",
    ]
    if memory:
        lines.append(f"حافظه AI: {memory[:300]}")
    if notes:
        lines.append(f"یادداشت: {notes}")
    if lead.last_message_at:
        lines.append(f"آخرین پیام: {lead.last_message_at.isoformat()}")
    return "\n".join(lines)


def build_conversation_document(db: Session, lead: Lead, *, limit: int = CONV_MSG_LIMIT) -> str:
    msgs = (
        db.query(Message)
        .filter(Message.org_id == lead.org_id, Message.lead_id == lead.id)
        .order_by(Message.created_at.desc())
        .limit(max(1, min(int(limit or CONV_MSG_LIMIT), 40)))
        .all()
    )
    msgs = list(reversed(msgs))
    header = (
        f"گفتگوی {(lead.name or '').strip() or 'مخاطب'} · مرحله {lead.stage or '—'} · "
        f"امتیاز {float(lead.lead_score or 0):.0f}"
    )
    lines = [header, ""]
    for m in msgs:
        if m.direction == MessageDirection.inbound:
            who = "مشتری"
        elif m.sender_type == SenderType.ai:
            who = "AI"
        elif m.sender_type == SenderType.agent:
            who = "کارشناس"
        else:
            who = "سیستم"
        body = (m.body or "").strip().replace("\n", " ")[:220]
        if body:
            lines.append(f"{who}: {body}")
    meta = lead.ai_meta if isinstance(lead.ai_meta, dict) else {}
    mem = meta.get("memory") if isinstance(meta.get("memory"), dict) else {}
    summary = str(mem.get("summary") or "").strip()
    if summary:
        lines.append("")
        lines.append(f"خلاصه AI: {summary[:400]}")
    return "\n".join(lines).strip()


def build_task_document(db: Session, task: Task) -> str:
    lead_name = ""
    if task.lead_id:
        lead = db.get(Lead, task.lead_id)
        if lead:
            lead_name = (lead.name or "").strip()
    status = task.status.value if hasattr(task.status, "value") else str(task.status)
    due = task.due_at.isoformat() if task.due_at else "—"
    excerpt = (task.message or "").strip()[:300]
    lines = [
        f"وظیفه: {(task.title or '').strip() or 'بدون عنوان'}",
        f"وضعیت: {status}",
        f"مسئول: {_user_label(db, task.assignee_id)}",
        f"سررسید: {due}",
        f"منبع: {task.source or 'manual'}",
    ]
    if lead_name:
        lines.append(f"مخاطب مرتبط: {lead_name}")
    if excerpt:
        lines.append(f"جزئیات: {excerpt}")
    return "\n".join(lines)


def build_team_snapshot(db: Session, org_id: str) -> str:
    from app.services.org_analytics import rank_hot_leads_today, rank_tasks_by_assignee

    hot = rank_hot_leads_today(db, org_id, limit=10)
    tasks = rank_tasks_by_assignee(db, org_id, limit=10)
    lines = [
        f"اسنپ‌شات تیم · {datetime.utcnow().date().isoformat()}",
        "",
        "داغ‌ترین لیدها:",
    ]
    if hot:
        for i, r in enumerate(hot, 1):
            lines.append(
                f"{i}. {r['name']} · {r['stage']} · hot {r['hot_score']} · "
                f"ورودی۲۴س {r['inbound_24h']}"
            )
    else:
        lines.append("(خالی)")
    lines.append("")
    lines.append("رتبه انجام وظایف:")
    if tasks:
        for i, r in enumerate(tasks, 1):
            lines.append(
                f"{i}. {r['name']}: انجام‌شده {r['tasks_done']} · باز {r['tasks_open']} · "
                f"عقب‌افتاده {r['tasks_overdue']}"
            )
    else:
        lines.append("(خالی)")
    return "\n".join(lines)


def _upsert_chunk(
    db: Session,
    *,
    org_id: str,
    entity_type: str,
    entity_id: str,
    content: str,
    lead_id: str | None = None,
    meta: dict[str, Any] | None = None,
    commit: bool = True,
    prefer_local: bool = False,
) -> CrmIndexChunk | None:
    from sqlalchemy.exc import IntegrityError

    content = (content or "").strip()
    if not content or not org_id or not entity_id:
        return None
    digest = content_sha1(content)

    def _find() -> CrmIndexChunk | None:
        return (
            db.query(CrmIndexChunk)
            .filter(
                CrmIndexChunk.org_id == org_id,
                CrmIndexChunk.entity_type == entity_type,
                CrmIndexChunk.entity_id == entity_id,
            )
            .first()
        )

    row = _find()
    if row and (row.content_hash or "") == digest and row.embedding:
        return row

    vec, provider = embed_crm_text(db, content, prefer_local=prefer_local)
    now = datetime.utcnow()
    payload_meta = {**(meta or {}), "embed_provider": provider}

    def _apply(existing: CrmIndexChunk) -> CrmIndexChunk:
        existing.content = content
        existing.content_hash = digest
        existing.embedding = vec
        existing.lead_id = lead_id
        existing.meta = payload_meta
        existing.updated_at = now
        db.add(existing)
        return existing

    if row:
        row = _apply(row)
    else:
        row = CrmIndexChunk(
            org_id=org_id,
            entity_type=entity_type,
            entity_id=entity_id,
            lead_id=lead_id,
            content=content,
            content_hash=digest,
            embedding=vec,
            meta=payload_meta,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        try:
            # Savepoint so a unique conflict does not abort the whole session
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            existing = _find()
            if not existing:
                raise
            row = _apply(existing)
            db.flush()

    if commit:
        db.commit()
        db.refresh(row)
    else:
        db.flush()
    return row


def upsert_lead_index(
    db: Session, org_id: str, lead_id: str, *, commit: bool = True, prefer_local: bool = False
) -> int:
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == org_id).first()
    if not lead:
        return 0
    n = 0
    if _upsert_chunk(
        db,
        org_id=org_id,
        entity_type=ENTITY_LEAD,
        entity_id=lead.id,
        content=build_lead_document(db, lead),
        lead_id=lead.id,
        meta={"name": lead.name or "", "stage": lead.stage or ""},
        commit=False,
        prefer_local=prefer_local,
    ):
        n += 1
    if _upsert_chunk(
        db,
        org_id=org_id,
        entity_type=ENTITY_CONVERSATION,
        entity_id=lead.id,
        content=build_conversation_document(db, lead),
        lead_id=lead.id,
        meta={"name": lead.name or ""},
        commit=False,
        prefer_local=prefer_local,
    ):
        n += 1
    if commit:
        db.commit()
    return n


def upsert_task_index(
    db: Session, org_id: str, task_id: str, *, commit: bool = True, prefer_local: bool = False
) -> int:
    task = db.query(Task).filter(Task.id == task_id, Task.org_id == org_id).first()
    if not task:
        return 0
    row = _upsert_chunk(
        db,
        org_id=org_id,
        entity_type=ENTITY_TASK,
        entity_id=task.id,
        content=build_task_document(db, task),
        lead_id=task.lead_id,
        meta={"status": getattr(task.status, "value", str(task.status))},
        commit=commit,
        prefer_local=prefer_local,
    )
    return 1 if row else 0


def upsert_team_snapshot(
    db: Session, org_id: str, *, commit: bool = True, prefer_local: bool = False
) -> int:
    row = _upsert_chunk(
        db,
        org_id=org_id,
        entity_type=ENTITY_TEAM_SNAPSHOT,
        entity_id=TEAM_SNAPSHOT_ID,
        content=build_team_snapshot(db, org_id),
        meta={"kind": "daily"},
        commit=commit,
        prefer_local=prefer_local,
    )
    return 1 if row else 0


def delete_entity_index(
    db: Session, org_id: str, entity_type: str, entity_id: str, *, commit: bool = True
) -> int:
    q = db.query(CrmIndexChunk).filter(
        CrmIndexChunk.org_id == org_id,
        CrmIndexChunk.entity_type == entity_type,
        CrmIndexChunk.entity_id == entity_id,
    )
    n = q.delete(synchronize_session=False)
    if commit:
        db.commit()
    return int(n or 0)


def enqueue_crm_index(
    *,
    org_id: str,
    entity_type: str,
    entity_id: str,
    action: str = "upsert",
) -> None:
    """Fire-and-forget Redis job for background CRM indexing."""
    if not org_id or not entity_id or entity_type not in ENTITY_TYPES:
        return
    try:
        from app.services.queue import enqueue

        enqueue(
            "crm_index",
            {
                "org_id": org_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "action": action,
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("crm_index enqueue failed: %s", exc)


def enqueue_lead_refresh(org_id: str, lead_id: str) -> None:
    if not org_id or not lead_id:
        return
    enqueue_crm_index(org_id=org_id, entity_type=ENTITY_LEAD, entity_id=lead_id)
    enqueue_crm_index(org_id=org_id, entity_type=ENTITY_CONVERSATION, entity_id=lead_id)


def handle_crm_index_job(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    org_id = str(payload.get("org_id") or "").strip()
    entity_type = str(payload.get("entity_type") or "").strip()
    entity_id = str(payload.get("entity_id") or "").strip()
    action = str(payload.get("action") or "upsert").strip().lower()
    if not org_id or not entity_id or entity_type not in ENTITY_TYPES:
        return {"ok": False, "reason": "incomplete"}
    if not org_index_enabled(db, org_id):
        return {"ok": True, "skipped": "disabled"}

    if action == "delete":
        n = delete_entity_index(db, org_id, entity_type, entity_id)
        return {"ok": True, "deleted": n}

    if entity_type in (ENTITY_LEAD, ENTITY_CONVERSATION):
        # Always refresh both lead profile + conversation together
        n = upsert_lead_index(db, org_id, entity_id)
        return {"ok": True, "upserted": n}
    if entity_type == ENTITY_TASK:
        n = upsert_task_index(db, org_id, entity_id)
        return {"ok": True, "upserted": n}
    if entity_type == ENTITY_TEAM_SNAPSHOT:
        n = upsert_team_snapshot(db, org_id)
        return {"ok": True, "upserted": n}
    return {"ok": False, "reason": "unknown_type"}


def reindex_org(
    db: Session, org_id: str, *, limit_leads: int = 500, prefer_local: bool = True
) -> dict[str, int]:
    """Full backfill for one org. Defaults to local embeddings for speed."""
    if not org_id:
        return {"leads": 0, "tasks": 0, "team": 0}
    leads = (
        db.query(Lead)
        .filter(Lead.org_id == org_id)
        .order_by(Lead.updated_at.desc())
        .limit(max(1, min(int(limit_leads), 2000)))
        .all()
    )
    lead_n = 0
    for lead in leads:
        lead_n += upsert_lead_index(
            db, org_id, lead.id, commit=True, prefer_local=prefer_local
        )
    tasks = (
        db.query(Task)
        .filter(Task.org_id == org_id)
        .order_by(Task.updated_at.desc())
        .limit(1000)
        .all()
    )
    task_n = 0
    for task in tasks:
        task_n += upsert_task_index(
            db, org_id, task.id, commit=True, prefer_local=prefer_local
        )
    team_n = upsert_team_snapshot(db, org_id, commit=True, prefer_local=prefer_local)
    return {"leads": lead_n, "tasks": task_n, "team": team_n}


def retrieve_crm_context(
    db: Session,
    org_id: str,
    query: str,
    *,
    k: int = 6,
    entity_types: list[str] | None = None,
) -> list[tuple[CrmIndexChunk, float]]:
    """Top-k CRM chunks for coach RAG. Org-scoped cosine over stored embeddings."""
    q = (query or "").strip()
    if not org_id or not q:
        return []
    filt = db.query(CrmIndexChunk).filter(CrmIndexChunk.org_id == org_id)
    if entity_types:
        allowed = [t for t in entity_types if t in ENTITY_TYPES]
        if allowed:
            filt = filt.filter(CrmIndexChunk.entity_type.in_(allowed))
    rows = filt.limit(2500).all()
    prefer_local = True
    for row in rows[:30]:
        meta = row.meta if isinstance(row.meta, dict) else {}
        provider = str(meta.get("embed_provider") or "")
        if provider.startswith("openai:"):
            prefer_local = False
            break
    vec, _ = embed_crm_text(db, q, prefer_local=prefer_local)
    scored: list[tuple[CrmIndexChunk, float]] = []
    for row in rows:
        emb = row.embedding or []
        if not emb:
            continue
        # Skip dim mismatch (e.g. local vs openai after key change)
        if len(emb) != len(vec):
            continue
        score = cosine(vec, emb)
        if score >= 0.02:
            scored.append((row, float(score)))
    scored.sort(key=lambda x: -x[1])
    return scored[: max(1, min(int(k or 6), 20))]


def format_crm_hits(hits: list[tuple[CrmIndexChunk, float]]) -> str:
    if not hits:
        return ""
    lines = [
        "### زمینه CRM (جستجوی معنایی)",
        "از متن‌های زیر فقط به‌عنوان شواهد استفاده کن؛ آمار رتبه‌بندی را از گزارش SQL بگیر.",
    ]
    for chunk, score in hits:
        title = f"{chunk.entity_type}:{chunk.entity_id[:8]}"
        meta = chunk.meta if isinstance(chunk.meta, dict) else {}
        name = str(meta.get("name") or "").strip()
        if name:
            title = f"{chunk.entity_type} · {name}"
        body = (chunk.content or "").strip()[:500]
        if not body:
            continue
        lines.append(f"- ({score:.2f}) [{title}]")
        for part in body.split("\n")[:12]:
            part = part.strip()
            if part:
                lines.append(f"  {part}")
    return "\n".join(lines)
