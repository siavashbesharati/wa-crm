"""Internal API for the Baileys WhatsApp sidecar (service-key auth)."""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    ChannelAccount,
    ChannelType,
    ConnectorRole,
    ConnectorSession,
    OutboundJob,
    OutboundStatus,
    WaAuthState,
)
from app.schemas import (
    MessageIngestIn,
    MessageIngestOut,
    WaAuthStateIn,
    WaAuthStateOut,
    WaPairStateIn,
)
from app.services.reply_trace import job_trace_id, trace_event
from app.services.wa_crypto import decrypt_text, encrypt_text

router = APIRouter(prefix="/internal/wa", tags=["wa-connector-internal"])


def require_connector_key(x_connector_key: str | None = Header(default=None, alias="X-Connector-Key")) -> None:
    settings = get_settings()
    expected = (settings.wa_connector_key or "").strip()
    if not expected or not x_connector_key or x_connector_key.strip() != expected:
        raise HTTPException(status_code=401, detail="invalid connector key")


def _baileys_account(db: Session, account_id: str) -> ChannelAccount:
    acc = db.get(ChannelAccount, account_id)
    if not acc:
        raise HTTPException(status_code=404, detail="account not found")
    if (acc.connector_type or "extension") != "baileys":
        raise HTTPException(status_code=400, detail="account is not baileys connector")
    if acc.channel != ChannelType.whatsapp:
        raise HTTPException(status_code=400, detail="account is not whatsapp")
    return acc


@router.get("/sessions")
def list_sessions(
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ChannelAccount)
        .filter(
            ChannelAccount.channel == ChannelType.whatsapp,
            ChannelAccount.connector_type == "baileys",
        )
        .order_by(ChannelAccount.created_at.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "org_id": r.org_id,
            "label": r.label,
            "external_id": r.external_id or "",
            "wa_jid": r.wa_jid or "",
            "pairing_state": r.pairing_state or "disconnected",
            "status": r.status or "disconnected",
        }
        for r in rows
    ]


@router.get("/sessions/{account_id}/auth", response_model=WaAuthStateOut)
def get_auth(
    account_id: str,
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    _baileys_account(db, account_id)
    row = db.query(WaAuthState).filter(WaAuthState.account_id == account_id).first()
    if not row:
        return WaAuthStateOut(account_id=account_id, creds_json="", keys_json="")
    return WaAuthStateOut(
        account_id=account_id,
        creds_json=decrypt_text(row.creds_enc or ""),
        keys_json=decrypt_text(row.keys_enc or ""),
    )


@router.put("/sessions/{account_id}/auth", response_model=WaAuthStateOut)
def put_auth(
    account_id: str,
    body: WaAuthStateIn,
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    _baileys_account(db, account_id)
    row = db.query(WaAuthState).filter(WaAuthState.account_id == account_id).first()
    if not row:
        row = WaAuthState(account_id=account_id)
        db.add(row)
    row.creds_enc = encrypt_text(body.creds_json or "")
    row.keys_enc = encrypt_text(body.keys_json or "")
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return WaAuthStateOut(
        account_id=account_id,
        creds_json=body.creds_json or "",
        keys_json=body.keys_json or "",
    )


@router.delete("/sessions/{account_id}/auth")
def clear_auth(
    account_id: str,
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    _baileys_account(db, account_id)
    row = db.query(WaAuthState).filter(WaAuthState.account_id == account_id).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.put("/sessions/{account_id}/pair-state")
def put_pair_state(
    account_id: str,
    body: WaPairStateIn,
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    acc = _baileys_account(db, account_id)
    if body.pairing_state:
        acc.pairing_state = body.pairing_state
    acc.qr_payload = body.qr_payload or ""
    if body.wa_jid:
        acc.wa_jid = body.wa_jid
        if not acc.external_id:
            phone = body.wa_jid.split("@")[0]
            acc.external_id = phone
    if body.external_id:
        acc.external_id = body.external_id
    if body.status:
        acc.status = body.status
    elif body.pairing_state == "connected":
        acc.status = "online"
        acc.qr_payload = ""
    elif body.pairing_state in ("disconnected", "qr_pending"):
        if body.pairing_state == "disconnected":
            acc.status = "offline"
    db.add(acc)
    db.commit()
    return {
        "ok": True,
        "account_id": acc.id,
        "pairing_state": acc.pairing_state,
        "status": acc.status,
    }


@router.post("/sessions/{account_id}/heartbeat")
def heartbeat(
    account_id: str,
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    acc = _baileys_account(db, account_id)
    device_id = f"baileys-{account_id}"
    session = (
        db.query(ConnectorSession)
        .filter(
            ConnectorSession.org_id == acc.org_id,
            ConnectorSession.account_id == account_id,
            ConnectorSession.device_id == device_id,
        )
        .first()
    )
    if not session:
        session = ConnectorSession(
            org_id=acc.org_id,
            account_id=account_id,
            device_id=device_id,
            role=ConnectorRole.baileys,
            status="online",
            last_seen_at=datetime.utcnow(),
        )
        db.add(session)
    else:
        session.role = ConnectorRole.baileys
        session.status = "online"
        session.last_seen_at = datetime.utcnow()
        db.add(session)
    if (acc.pairing_state or "") == "connected":
        acc.status = "online"
        db.add(acc)
    db.commit()
    db.refresh(session)
    return {"ok": True, "session_id": session.id, "device_id": device_id}


@router.post("/sessions/{account_id}/ingest", response_model=MessageIngestOut)
def ingest(
    account_id: str,
    body: MessageIngestIn,
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    acc = _baileys_account(db, account_id)
    if body.account_id and body.account_id != account_id:
        raise HTTPException(status_code=400, detail="account_id mismatch")
    body.account_id = account_id
    from app.services.ingest_service import process_message_ingest

    return process_message_ingest(
        db,
        acc.org_id,
        body,
        None,
        allow_baileys_extension=True,
    )


@router.post("/jobs/claim")
def claim_jobs(
    account_id: str = Query(...),
    limit: int = Query(default=5, ge=1, le=20),
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    acc = _baileys_account(db, account_id)
    device_id = f"baileys-{account_id}"

    # Reclaim stale claimed jobs (>5 min)
    stale_cutoff = datetime.utcnow() - timedelta(minutes=5)
    stale = (
        db.query(OutboundJob)
        .filter(
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

    session = (
        db.query(ConnectorSession)
        .filter(
            ConnectorSession.org_id == acc.org_id,
            ConnectorSession.account_id == account_id,
            ConnectorSession.device_id == device_id,
        )
        .first()
    )
    if not session:
        session = ConnectorSession(
            org_id=acc.org_id,
            account_id=account_id,
            device_id=device_id,
            role=ConnectorRole.baileys,
            status="online",
            last_seen_at=datetime.utcnow(),
        )
        db.add(session)
        db.flush()
    else:
        session.last_seen_at = datetime.utcnow()
        session.status = "online"
        session.role = ConnectorRole.baileys
        db.add(session)

    jobs = (
        db.query(OutboundJob)
        .filter(
            OutboundJob.org_id == acc.org_id,
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
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    job = db.get(OutboundJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    acc = db.get(ChannelAccount, job.account_id)
    if not acc or (acc.connector_type or "") != "baileys":
        raise HTTPException(status_code=400, detail="not a baileys job")
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
        connector="baileys",
    )
    return {"ok": True}


@router.get("/sessions/{account_id}/pair-command")
def get_pair_command(
    account_id: str,
    _: None = Depends(require_connector_key),
    db: Session = Depends(get_db),
):
    """Sidecar polls this to learn when the panel requested QR pairing / logout."""
    acc = _baileys_account(db, account_id)
    return {
        "account_id": acc.id,
        "pairing_state": acc.pairing_state or "disconnected",
        "status": acc.status or "disconnected",
        "wa_jid": acc.wa_jid or "",
    }
