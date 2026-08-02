from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import (
    KpiSnapshot,
    Lead,
    MemberRole,
    Message,
    MessageDirection,
    OkrObjective,
    Task,
    TaskStatus,
)
from app.schemas import OkrIn, OkrOut

router = APIRouter(prefix="/kpi", tags=["kpi"])


@router.post("/rollup")
def rollup(auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)), db: Session = Depends(get_db)):
    org_id = auth.org.id
    week_ago = datetime.utcnow() - timedelta(days=7)

    total_leads = db.query(func.count(Lead.id)).filter(Lead.org_id == org_id).scalar() or 0
    closed = (
        db.query(func.count(Lead.id)).filter(Lead.org_id == org_id, Lead.stage == "خرید").scalar() or 0
    )
    conversion = (closed / total_leads * 100.0) if total_leads else 0.0

    inbound = (
        db.query(func.count(Message.id))
        .filter(
            Message.org_id == org_id,
            Message.direction == MessageDirection.inbound,
            Message.created_at >= week_ago,
        )
        .scalar()
        or 0
    )
    outbound = (
        db.query(func.count(Message.id))
        .filter(
            Message.org_id == org_id,
            Message.direction == MessageDirection.outbound,
            Message.created_at >= week_ago,
        )
        .scalar()
        or 0
    )
    tasks_open = (
        db.query(func.count(Task.id))
        .filter(Task.org_id == org_id, Task.status == TaskStatus.open)
        .scalar()
        or 0
    )
    tasks_done = (
        db.query(func.count(Task.id))
        .filter(Task.org_id == org_id, Task.status == TaskStatus.done, Task.updated_at >= week_ago)
        .scalar()
        or 0
    )
    overdue = (
        db.query(func.count(Task.id))
        .filter(
            Task.org_id == org_id,
            Task.status == TaskStatus.open,
            Task.due_at.is_not(None),
            Task.due_at < datetime.utcnow(),
        )
        .scalar()
        or 0
    )

    metrics = {
        "leads_total": float(total_leads),
        "conversion_rate": round(conversion, 2),
        "messages_inbound_7d": float(inbound),
        "messages_outbound_7d": float(outbound),
        "tasks_open": float(tasks_open),
        "tasks_done_7d": float(tasks_done),
        "tasks_overdue": float(overdue),
    }
    for key, value in metrics.items():
        db.add(KpiSnapshot(org_id=org_id, key=key, value=value, period="weekly"))
    db.commit()
    return {"ok": True, "metrics": metrics}


@router.get("/dashboard")
def dashboard(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    # latest snapshot per key
    keys = [
        "leads_total",
        "conversion_rate",
        "messages_inbound_7d",
        "messages_outbound_7d",
        "tasks_open",
        "tasks_done_7d",
        "tasks_overdue",
    ]
    metrics = {}
    for key in keys:
        snap = (
            db.query(KpiSnapshot)
            .filter(KpiSnapshot.org_id == auth.org.id, KpiSnapshot.key == key)
            .order_by(KpiSnapshot.captured_at.desc())
            .first()
        )
        metrics[key] = snap.value if snap else 0

    # funnel by stage
    stages = ["جدید", "پیگیری", "پیشنهاد", "خرید", "بسته"]
    funnel = []
    for stage in stages:
        count = (
            db.query(func.count(Lead.id))
            .filter(Lead.org_id == auth.org.id, Lead.stage == stage)
            .scalar()
            or 0
        )
        funnel.append({"stage": stage, "count": count})

    agent_stats = []
    from app.models import Membership, User

    members = (
        db.query(Membership, User)
        .join(User, User.id == Membership.user_id)
        .filter(Membership.org_id == auth.org.id)
        .all()
    )
    for membership, user in members:
        assigned = (
            db.query(func.count(Lead.id))
            .filter(Lead.org_id == auth.org.id, Lead.assignee_id == user.id)
            .scalar()
            or 0
        )
        done = (
            db.query(func.count(Task.id))
            .filter(
                Task.org_id == auth.org.id,
                Task.assignee_id == user.id,
                Task.status == TaskStatus.done,
            )
            .scalar()
            or 0
        )
        open_tasks = (
            db.query(func.count(Task.id))
            .filter(
                Task.org_id == auth.org.id,
                Task.assignee_id == user.id,
                Task.status == TaskStatus.open,
            )
            .scalar()
            or 0
        )
        agent_stats.append(
            {
                "user_id": user.id,
                "name": user.display_name or user.phone,
                "assigned_leads": assigned,
                "tasks_done": done,
                "tasks_open": open_tasks,
            }
        )

    return {"metrics": metrics, "funnel": funnel, "agents": agent_stats}


@router.get("/okrs", response_model=list[OkrOut])
def list_okrs(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    rows = db.query(OkrObjective).filter(OkrObjective.org_id == auth.org.id).all()
    out = []
    for r in rows:
        progress = (r.current_value / r.target_value * 100.0) if r.target_value else 0.0
        out.append(
            OkrOut(
                id=r.id,
                title=r.title,
                description=r.description,
                target_value=r.target_value,
                current_value=r.current_value,
                period=r.period,
                owner_id=r.owner_id,
                progress=round(min(progress, 100.0), 1),
            )
        )
    return out


@router.post("/okrs", response_model=OkrOut)
def create_okr(
    body: OkrIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    row = OkrObjective(
        org_id=auth.org.id,
        title=body.title,
        description=body.description,
        target_value=body.target_value,
        current_value=body.current_value,
        period=body.period,
        owner_id=body.owner_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    progress = (row.current_value / row.target_value * 100.0) if row.target_value else 0.0
    return OkrOut(
        id=row.id,
        title=row.title,
        description=row.description,
        target_value=row.target_value,
        current_value=row.current_value,
        period=row.period,
        owner_id=row.owner_id,
        progress=round(min(progress, 100.0), 1),
    )
