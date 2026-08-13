from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth
from app.models import Task, TaskStatus
from app.schemas import TaskBoardReorderIn, TaskIn, TaskOut
from app.services.contact_tasks import (
    create_task_for_contact,
    next_board_order,
    parse_task_status,
    task_to_out,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])

TASK_STATUSES = [s.value for s in TaskStatus]
STATUS_RANK = {s: i for i, s in enumerate(TASK_STATUSES)}


@router.get("", response_model=list[TaskOut])
def list_tasks(
    status: str | None = None,
    lead_id: str | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    q = db.query(Task).filter(Task.org_id == auth.org.id)
    if status:
        q = q.filter(Task.status == parse_task_status(status))
    if lead_id:
        q = q.filter(Task.lead_id == lead_id)
    rows = q.limit(300).all()
    rows.sort(
        key=lambda t: (
            STATUS_RANK.get(t.status.value, 99),
            int(getattr(t, "board_order", 0) or 0),
            t.created_at or datetime.min,
        )
    )
    return [task_to_out(r) for r in rows]


@router.post("", response_model=TaskOut)
def create_task(body: TaskIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    if body.lead_id:
        task = create_task_for_contact(
            db,
            org_id=auth.org.id,
            lead_id=body.lead_id,
            title=body.title,
            message=body.message,
            assignee_id=body.assignee_id,
            created_by_id=auth.user.id,
            due_at=body.due_at,
            status=body.status,
            source=body.source or "manual",
            source_message_id=body.source_message_id,
            conversation_excerpt=body.conversation_excerpt,
        )
        return task_to_out(task)

    status = parse_task_status(body.status)
    task = Task(
        org_id=auth.org.id,
        title=body.title or (body.message[:80] if body.message else "وظیفه"),
        message=body.message,
        assignee_id=body.assignee_id or auth.user.id,
        created_by_id=auth.user.id,
        due_at=body.due_at,
        status=status,
        board_order=next_board_order(db, auth.org.id, status),
        source=(body.source or "manual").strip().lower() or "manual",
        source_message_id=(body.source_message_id or "").strip(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task_to_out(task)


@router.post("/board-order")
def update_board_order(
    body: TaskBoardReorderIn,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    if not body.updates:
        return {"ok": True}
    ids = [u.id for u in body.updates]
    rows = db.query(Task).filter(Task.org_id == auth.org.id, Task.id.in_(ids)).all()
    by_id = {r.id: r for r in rows}
    now = datetime.utcnow()
    for item in body.updates:
        task = by_id.get(item.id)
        if not task:
            continue
        status = parse_task_status(item.status, task.status)
        task.status = status
        task.board_order = int(item.board_order)
        task.updated_at = now
        db.add(task)
    db.commit()
    return {"ok": True, "updated": len(body.updates)}


def _set_status(db: Session, auth: AuthContext, task_id: str, status: TaskStatus) -> Task:
    task = db.query(Task).filter(Task.id == task_id, Task.org_id == auth.org.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="وظیفه یافت نشد")
    if task.status != status:
        task.board_order = next_board_order(db, auth.org.id, status)
        task.status = status
    task.updated_at = datetime.utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/done", response_model=TaskOut)
def complete_task(task_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    return task_to_out(_set_status(db, auth, task_id, TaskStatus.done))


@router.post("/{task_id}/cancel", response_model=TaskOut)
def cancel_task(task_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    return task_to_out(_set_status(db, auth, task_id, TaskStatus.cancelled))
