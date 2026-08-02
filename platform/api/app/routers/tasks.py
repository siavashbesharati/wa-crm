from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth
from app.models import Task, TaskStatus
from app.schemas import TaskIn, TaskOut

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _to_out(t: Task) -> TaskOut:
    return TaskOut(
        id=t.id,
        title=t.title,
        message=t.message,
        lead_id=t.lead_id,
        assignee_id=t.assignee_id,
        created_by_id=t.created_by_id,
        due_at=t.due_at,
        status=t.status.value,
        created_at=t.created_at,
    )


@router.get("", response_model=list[TaskOut])
def list_tasks(
    status: str | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    q = db.query(Task).filter(Task.org_id == auth.org.id)
    if status:
        q = q.filter(Task.status == TaskStatus(status))
    rows = q.order_by(Task.created_at.desc()).limit(300).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=TaskOut)
def create_task(body: TaskIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    task = Task(
        org_id=auth.org.id,
        lead_id=body.lead_id,
        title=body.title or (body.message[:80] if body.message else "وظیفه"),
        message=body.message,
        assignee_id=body.assignee_id or auth.user.id,
        created_by_id=auth.user.id,
        due_at=body.due_at,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_out(task)


@router.post("/{task_id}/done", response_model=TaskOut)
def complete_task(task_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.org_id == auth.org.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="وظیفه یافت نشد")
    task.status = TaskStatus.done
    task.updated_at = datetime.utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_out(task)


@router.post("/{task_id}/cancel", response_model=TaskOut)
def cancel_task(task_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.org_id == auth.org.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="وظیفه یافت نشد")
    task.status = TaskStatus.cancelled
    task.updated_at = datetime.utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_out(task)
