from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
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
from app.services.reply_trace import job_trace_id, trace_event
from app.services.sse_hub import format_sse, sse_hub

router = APIRouter(prefix="/channels", tags=["channels"])


def _account_out(r: ChannelAccount, *, live_online: bool | None = None) -> ChannelAccountOut:
    if live_online is None:
        status = r.status or "disconnected"
    else:
        status = "online" if live_online else "offline"
    return ChannelAccountOut(
        id=r.id,
        channel=r.channel.value if isinstance(r.channel, ChannelType) else str(r.channel),
        label=r.label,
        external_id=r.external_id or "",
        phone=r.phone or (r.external_id if r.channel == ChannelType.whatsapp else ""),
        status=status,
    )


def _online_account_ids(db: Session, org_id: str, within_seconds: int = 90) -> set[str]:
    """Accounts with a connector session seen recently."""
    cutoff = datetime.utcnow() - timedelta(seconds=within_seconds)
    rows = (
        db.query(ConnectorSession.account_id)
        .filter(
            ConnectorSession.org_id == org_id,
            ConnectorSession.last_seen_at >= cutoff,
            ConnectorSession.status == "online",
        )
        .distinct()
        .all()
    )
    return {row[0] for row in rows if row[0]}


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
    online_ids = _online_account_ids(db, auth.org.id)
    # Keep stored status in sync with live presence
    dirty = False
    for r in rows:
        want = "online" if r.id in online_ids else "offline"
        if (r.status or "") != want:
            r.status = want
            db.add(r)
            dirty = True
    if dirty:
        db.commit()
    return [_account_out(r, live_online=(r.id in online_ids)) for r in rows]


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
            device_id=body.device_id or "unknown",
            role=role,
            status="online",
            last_seen_at=datetime.utcnow(),
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
    db.refresh(session)
    return {
        "ok": True,
        "session_id": session.id,
        "role": session.role.value,
        "channel": acc.channel.value,
        "account_status": "online",
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


@router.get("/events/stream")
async def events_stream(
    request: Request,
    account_id: str = Query(default=""),
    device_id: str = Query(default=""),
):
    """
    SSE stream. Prefer org-wide (no account_id) so one extension gets WA+Divar nudges.
    Optional account_id scopes to a single channel account.
    Emits: hello, job_ready, keepalives.

    DB session is closed before the long-lived stream starts so SQLite pool
    slots are not held open for the entire SSE connection.
    """
    # Avoid Depends(get_db)/get_auth — those keep the session open until
    # StreamingResponse finishes (hours for SSE).
    authorization = request.headers.get("authorization")
    x_org_id = request.headers.get("x-org-id")

    aid = (account_id or "").strip()
    pending_id = ""
    pending_account = ""
    org_id = ""
    sub_key = ""
    account_filter = ""

    db = SessionLocal()
    try:
        auth = get_auth(authorization=authorization, x_org_id=x_org_id, db=db)
        org_id = auth.org.id
        if aid:
            acc = (
                db.query(ChannelAccount)
                .filter(ChannelAccount.id == aid, ChannelAccount.org_id == org_id)
                .first()
            )
            if not acc:
                raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")
            sub_key = aid
            account_filter = aid
        else:
            sub_key = f"org:{org_id}"
            account_filter = ""

        q_pending = db.query(OutboundJob).filter(
            OutboundJob.org_id == org_id,
            OutboundJob.status == OutboundStatus.queued,
        )
        if account_filter:
            q_pending = q_pending.filter(OutboundJob.account_id == account_filter)
        pending = q_pending.order_by(OutboundJob.created_at.asc()).first()
        if pending:
            pending_id = pending.id
            pending_account = pending.account_id
    finally:
        db.close()

    try:
        sse_hub.bind_loop()
    except RuntimeError:
        pass

    async def event_generator():
        q = await sse_hub.subscribe(sub_key)
        try:
            yield format_sse(
                "hello",
                {
                    "account_id": account_filter or "",
                    "sub_key": sub_key,
                    "device_id": device_id or "",
                    "org_id": org_id,
                    "subscribers": sse_hub.subscriber_count(sub_key),
                },
            )
            if pending_id:
                yield format_sse(
                    "job_ready",
                    {
                        "account_id": pending_account,
                        "job_id": pending_id,
                        "reason": "pending_on_connect",
                        "org_id": org_id,
                    },
                )
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=25.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                ev = str(payload.get("event") or "message")
                data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
                yield format_sse(ev, data)
        finally:
            await sse_hub.unsubscribe(sub_key, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
                "trace_id": job_trace_id(job.id),
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
    trace_event(
        job_trace_id(job_id),
        "job_complete",
        job_id=job_id,
        ok=ok,
        error=error or "",
        target=job.target_name,
    )
    return {"ok": True}
