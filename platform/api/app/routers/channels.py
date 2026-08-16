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
    DivarAuthState,
    LeadAccountLink,
    MemberRole,
    Message,
    OutboundJob,
    OutboundStatus,
    WaAuthState,
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
        connector_type=getattr(r, "connector_type", None) or "extension",
        pairing_state=getattr(r, "pairing_state", None) or "disconnected",
        wa_jid=getattr(r, "wa_jid", None) or "",
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


def _purge_account_auth_and_row(db: Session, acc: ChannelAccount) -> None:
    """Wipe stored session/auth and delete the channel account row."""
    account_id = acc.id
    org_id = acc.org_id
    db.query(WaAuthState).filter(WaAuthState.account_id == account_id).delete(synchronize_session=False)
    db.query(DivarAuthState).filter(DivarAuthState.account_id == account_id).delete(
        synchronize_session=False
    )
    db.query(ConnectorSession).filter(
        ConnectorSession.org_id == org_id, ConnectorSession.account_id == account_id
    ).delete(synchronize_session=False)
    db.query(OutboundJob).filter(
        OutboundJob.org_id == org_id, OutboundJob.account_id == account_id
    ).delete(synchronize_session=False)
    db.query(LeadAccountLink).filter(
        LeadAccountLink.org_id == org_id, LeadAccountLink.account_id == account_id
    ).delete(synchronize_session=False)
    db.query(Message).filter(Message.org_id == org_id, Message.account_id == account_id).delete(
        synchronize_session=False
    )
    db.delete(acc)
    db.commit()


@router.delete("/accounts/{account_id}")
def delete_account(
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == account_id, ChannelAccount.org_id == auth.org.id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")
    _purge_account_auth_and_row(db, acc)
    return {"ok": True, "deleted": True}


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
    connector_type = (body.connector_type or "").strip().lower()
    if connector_type not in ("baileys", "divar_api"):
        # Default by channel — Chrome extension connector removed
        connector_type = "baileys" if ch == ChannelType.whatsapp else "divar_api"
    if connector_type == "baileys" and ch != ChannelType.whatsapp:
        raise HTTPException(status_code=400, detail="Baileys فقط برای واتساپ است")
    if connector_type == "divar_api" and ch != ChannelType.divar:
        raise HTTPException(status_code=400, detail="divar_api فقط برای دیوار است")
    acc = ChannelAccount(
        org_id=auth.org.id,
        channel=ch,
        label=label,
        external_id=external_id,
        connector_type=connector_type,
        pairing_state="disconnected",
        status="disconnected",
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
    from app.services.setup_tasks import maybe_complete_setup_tasks_for_account

    maybe_complete_setup_tasks_for_account(db, acc)
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
    """Prefer server connector roles for baileys/divar_api accounts."""
    cutoff = datetime.utcnow() - timedelta(seconds=90)
    acc = db.get(ChannelAccount, account_id)
    base = db.query(ConnectorSession).filter(
        ConnectorSession.org_id == org_id,
        ConnectorSession.account_id == account_id,
        ConnectorSession.last_seen_at >= cutoff,
        ConnectorSession.status == "online",
    )
    ctype = (getattr(acc, "connector_type", None) or "extension") if acc else "extension"
    if ctype == "baileys":
        return base.filter(ConnectorSession.role == ConnectorRole.baileys).first()
    if ctype == "divar_api":
        return base.filter(ConnectorSession.role == ConnectorRole.divar).first()
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
    acc = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == account_id, ChannelAccount.org_id == auth.org.id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")

    # Server connectors own their outbound queues
    ctype = (getattr(acc, "connector_type", None) or "extension")
    if ctype == "baileys":
        session = (
            db.query(ConnectorSession)
            .filter(
                ConnectorSession.org_id == auth.org.id,
                ConnectorSession.account_id == account_id,
                ConnectorSession.device_id == device_id,
            )
            .first()
        )
        if not session or session.role != ConnectorRole.baileys:
            return {"jobs": []}
    elif ctype == "divar_api":
        session = (
            db.query(ConnectorSession)
            .filter(
                ConnectorSession.org_id == auth.org.id,
                ConnectorSession.account_id == account_id,
                ConnectorSession.device_id == device_id,
            )
            .first()
        )
        if not session or session.role != ConnectorRole.divar:
            return {"jobs": []}

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
        if preferred.role in (ConnectorRole.baileys, ConnectorRole.divar):
            return {"jobs": []}
        if preferred.role == ConnectorRole.connector or session.role != ConnectorRole.connector:
            if preferred.id != session.id:
                return {"jobs": []}

    # Reclaim stale claimed jobs (>5 min)
    stale_cutoff = datetime.utcnow() - timedelta(minutes=5)
    stale = (
        db.query(OutboundJob)
        .filter(
            OutboundJob.org_id == auth.org.id,
            OutboundJob.account_id == account_id,
            OutboundJob.status == OutboundStatus.claimed,
            OutboundJob.updated_at < stale_cutoff,
        )
        .all()
    )
    for job in stale:
        job.status = OutboundStatus.queued
        job.claimed_by_session_id = None
        job.updated_at = datetime.utcnow()
        db.add(job)

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
                "target_jid": getattr(job, "target_jid", "") or "",
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
    try:
        from app.services.campaign_send import apply_job_result_to_campaign_send

        apply_job_result_to_campaign_send(
            db, job_id=job_id, ok=ok, error=error or ""
        )
    except Exception:  # noqa: BLE001
        pass
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
