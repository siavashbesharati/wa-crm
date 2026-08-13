from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Lead, Task, TaskStatus, User
from app.schemas import TaskOut

TASK_STATUSES = {s.value for s in TaskStatus}
TASK_SOURCES = {"manual", "ai", "system"}


def parse_task_status(value: str | None, fallback: TaskStatus = TaskStatus.open) -> TaskStatus:
    if not value:
        return fallback
    raw = value.strip().lower()
    if raw not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail="وضعیت نامعتبر است")
    return TaskStatus(raw)


def next_board_order(db: Session, org_id: str, status: TaskStatus) -> int:
    current = (
        db.query(func.max(Task.board_order))
        .filter(Task.org_id == org_id, Task.status == status)
        .scalar()
    )
    return int(current or -1) + 1


def get_org_lead(db: Session, org_id: str, lead_id: str) -> Lead:
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == org_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="مخاطب یافت نشد")
    return lead


def create_task_for_contact(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    title: str = "",
    message: str = "",
    assignee_id: str | None = None,
    created_by_id: str | None = None,
    due_at: datetime | None = None,
    status: str | None = None,
    source: str = "manual",
    source_message_id: str = "",
    conversation_excerpt: str = "",
) -> Task:
    """Create a follow-up task attached to a contact. Used by UI and AI agent."""
    lead = get_org_lead(db, org_id, lead_id)
    src = (source or "manual").strip().lower() or "manual"
    if src not in TASK_SOURCES:
        raise HTTPException(status_code=400, detail="منبع وظیفه نامعتبر است")

    body = (message or "").strip()
    excerpt = (conversation_excerpt or "").strip()
    if excerpt and excerpt not in body:
        body = f"{body}\n\n--- گفتگو ---\n{excerpt}".strip() if body else excerpt

    heading = (title or "").strip() or (body[:80] if body else f"پیگیری {lead.name}".strip())
    task_status = parse_task_status(status)

    if assignee_id:
        user = db.get(User, assignee_id)
        if not user:
            assignee_id = lead.assignee_id
    else:
        assignee_id = lead.assignee_id

    task = Task(
        org_id=org_id,
        lead_id=lead.id,
        title=heading,
        message=body,
        assignee_id=assignee_id,
        created_by_id=created_by_id,
        due_at=due_at,
        status=task_status,
        board_order=next_board_order(db, org_id, task_status),
        source=src,
        source_message_id=(source_message_id or "").strip(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def task_to_out(t: Task) -> TaskOut:
    return TaskOut(
        id=t.id,
        title=t.title,
        message=t.message,
        lead_id=t.lead_id,
        assignee_id=t.assignee_id,
        created_by_id=t.created_by_id,
        due_at=t.due_at,
        status=t.status.value,
        board_order=int(getattr(t, "board_order", 0) or 0),
        source=getattr(t, "source", None) or "manual",
        source_message_id=getattr(t, "source_message_id", None) or "",
        created_at=t.created_at,
    )
