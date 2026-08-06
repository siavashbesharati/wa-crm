from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import (
    ChannelAccount,
    ChannelType,
    ConnectorRole,
    ConnectorSession,
    MemberRole,
    OutboundJob,
    OutboundStatus,
)
from app.plans import plan_limits
from app.schemas import ChannelAccountIn, ChannelAccountOut, HeartbeatIn

router = APIRouter(prefix="/channels", tags=["channels"])


def _account_out(r: ChannelAccount) -> ChannelAccountOut:
    return ChannelAccountOut(
        id=r.id,
        channel=r.channel.value if isinstance(r.channel, ChannelType) else str(r.channel),
        label=r.label,
        external_id=r.external_id or "",
        phone=r.phone or (r.external_id if r.channel == ChannelType.whatsapp else ""),
        status=r.status,
    )


def _parse_channel(raw: str | None, default: ChannelType = ChannelType.whatsapp) -> ChannelType:
    if not raw:
        return default
    try:
        return ChannelType(str(raw).strip().lower())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="کانال نامعتبر است") from exc


@router.get("/accounts", response_model=list[ChannelAccountOut])
def list_accounts(
    channel: str | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    q = db.query(ChannelAccount).filter(ChannelAccount.org_id == auth.org.id)
    if channel:
        q = q.filter(ChannelAccount.channel == _parse_channel(channel))
    rows = q.order_by(ChannelAccount.created_at.asc()).all()
    return [_account_out(r) for r in rows]


@router.post("/accounts", response_model=ChannelAccountOut)
def create_account(
    body: ChannelAccountIn,
    auth: AuthContext = Depends(
        require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)
    ),
    db: Session = Depends(get_db),
):
    # Channels are unlimited; plan limits concurrent extension seats instead.
    _ = plan_limits(auth.org.plan)

    ch = _parse_channel(body.channel)
    external_id = (body.external_id or body.phone or "").strip()
    label = (body.label or external_id or ch.value).strip()
    acc = ChannelAccount(
        org_id=auth.org.id,
        channel=ch,
        label=label,
        external_id=external_id,
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _account_out(acc)


@router.post("/heartbeat")
def heartbeat(body: HeartbeatIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    acc = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == body.account_id, ChannelAccount.org_id == auth.org.id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")
    try:
        role = ConnectorRole(body.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="نقش کانکتور نامعتبر است") from exc

    session = (
        db.query(ConnectorSession)
        .filter(
            ConnectorSession.org_id == auth.org.id,
            ConnectorSession.account_id == body.account_id,
            ConnectorSession.device_id == body.device_id,
        )
        .first()
    )
    if not session:
        session = ConnectorSession(
            org_id=auth.org.id,
            account_id=body.account_id,
            user_id=auth.user.id,
            device_id=body.device_id,
            role=role,
        )
        db.add(session)
    else:
        session.role = role
        session.user_id = auth.user.id
        session.status = "online"
        session.last_seen_at = datetime.utcnow()
        db.add(session)

    acc.status = "online"
    db.add(acc)
    db.commit()
    return {
        "ok": True,
        "session_id": session.id,
        "role": session.role.value,
        "channel": acc.channel.value,
    }


@router.get("/sessions")
def list_sessions(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    cutoff = datetime.utcnow() - timedelta(seconds=90)
    rows = (
        db.query(ConnectorSession)
        .filter(ConnectorSession.org_id == auth.org.id, ConnectorSession.last_seen_at >= cutoff)
        .all()
    )
    return [
        {
            "id": r.id,
            "account_id": r.account_id,
            "device_id": r.device_id,
            "role": r.role.value,
            "status": r.status,
            "last_seen_at": r.last_seen_at.isoformat(),
        }
        for r in rows
    ]


def pick_session(db: Session, org_id: str, account_id: str) -> ConnectorSession | None:
    """Hybrid: prefer connector, else any online agent session."""
    cutoff = datetime.utcnow() - timedelta(seconds=90)
    base = db.query(ConnectorSession).filter(
        ConnectorSession.org_id == org_id,
        ConnectorSession.account_id == account_id,
        ConnectorSession.last_seen_at >= cutoff,
        ConnectorSession.status == "online",
    )
    connector = base.filter(ConnectorSession.role == ConnectorRole.connector).first()
    if connector:
        return connector
    return base.filter(ConnectorSession.role == ConnectorRole.agent).first()


@router.post("/jobs/claim")
def claim_jobs(
    account_id: str,
    device_id: str,
    limit: int = 5,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ConnectorSession)
        .filter(
            ConnectorSession.org_id == auth.org.id,
            ConnectorSession.account_id == account_id,
            ConnectorSession.device_id == device_id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=400, detail="ابتدا heartbeat بزنید")

    preferred = pick_session(db, auth.org.id, account_id)
    if preferred and preferred.device_id != device_id:
        if preferred.role == ConnectorRole.connector or session.role != ConnectorRole.connector:
            if preferred.id != session.id:
                return {"jobs": []}

    jobs = (
        db.query(OutboundJob)
        .filter(
            OutboundJob.org_id == auth.org.id,
            OutboundJob.account_id == account_id,
            OutboundJob.status == OutboundStatus.queued,
        )
        .order_by(OutboundJob.created_at.asc())
        .limit(limit)
        .all()
    )
    out = []
    for job in jobs:
        job.status = OutboundStatus.claimed
        job.claimed_by_session_id = session.id
        job.updated_at = datetime.utcnow()
        db.add(job)
        out.append(
            {
                "id": job.id,
                "account_id": job.account_id,
                "lead_id": job.lead_id,
                "target_name": job.target_name,
                "body": job.body,
                "sender_type": job.sender_type.value,
                "status": job.status.value,
            }
        )
    db.commit()
    return {"jobs": out}


@router.post("/jobs/{job_id}/complete")
def complete_job(
    job_id: str,
    ok: bool = True,
    error: str = "",
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    job = db.query(OutboundJob).filter(OutboundJob.id == job_id, OutboundJob.org_id == auth.org.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="جاب یافت نشد")
    job.status = OutboundStatus.sent if ok else OutboundStatus.failed
    job.error = error or ""
    job.updated_at = datetime.utcnow()
    db.add(job)
    db.commit()
    return {"ok": True}
