"""Internal API for the Bale sidecar (service-key auth). Never expose tokens publicly."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    BaleAuthState,
    ChannelAccount,
    ChannelType,
    ConnectorRole,
    ConnectorSession,
    OutboundJob,
    OutboundStatus,
)
from app.schemas import BaleAuthStateIn, BaleAuthStateOut, MessageIngestIn
from app.services.phone import normalize_phone_for_storage
from app.services.reply_trace import job_trace_id, trace_event
from app.services.wa_crypto import decrypt_text, encrypt_text

router = APIRouter(prefix="/internal/bale", tags=["bale-connector-internal"])


def require_bale_connector_key(
    x_connector_key: str | None = Header(default=None, alias="X-Connector-Key"),
) -> None:
    settings = get_settings()
    expected = (settings.bale_connector_key or "").strip()
    if not expected or not x_connector_key or x_connector_key.strip() != expected:
        raise HTTPException(status_code=401, detail="invalid connector key")


def _bale_account(db: Session, account_id: str) -> ChannelAccount:
    acc = db.get(ChannelAccount, account_id)
    if not acc:
        raise HTTPException(status_code=404, detail="account not found")
    if (acc.connector_type or "") != "bale_api":
        raise HTTPException(status_code=400, detail="account is not bale_api connector")
    if acc.channel != ChannelType.bale:
        raise HTTPException(status_code=400, detail="account is not bale")
    return acc


@router.get("/sessions")
def list_sessions(
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ChannelAccount)
        .filter(
            ChannelAccount.channel == ChannelType.bale,
            ChannelAccount.connector_type == "bale_api",
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
            "pairing_state": r.pairing_state or "disconnected",
            "status": r.status or "disconnected",
        }
        for r in rows
    ]


@router.get("/sessions/{account_id}/auth", response_model=BaleAuthStateOut)
def get_auth(
    account_id: str,
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    _bale_account(db, account_id)
    row = db.query(BaleAuthState).filter(BaleAuthState.account_id == account_id).first()
    if not row:
        return BaleAuthStateOut(account_id=account_id)
    return BaleAuthStateOut(
        account_id=account_id,
        token_json=decrypt_text(row.token_enc or ""),
        pending_json=decrypt_text(row.pending_enc or ""),
        cursors_json=row.cursors_json or "",
    )


@router.put("/sessions/{account_id}/auth", response_model=BaleAuthStateOut)
def put_auth(
    account_id: str,
    body: BaleAuthStateIn,
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    _bale_account(db, account_id)
    row = db.query(BaleAuthState).filter(BaleAuthState.account_id == account_id).first()
    if not row:
        row = BaleAuthState(account_id=account_id)
        db.add(row)
    if body.token_json is not None and body.token_json != "":
        row.token_enc = encrypt_text(body.token_json)
    if body.pending_json is not None:
        row.pending_enc = encrypt_text(body.pending_json) if body.pending_json else ""
    if body.cursors_json is not None:
        row.cursors_json = body.cursors_json
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return BaleAuthStateOut(
        account_id=account_id,
        token_json=decrypt_text(row.token_enc or ""),
        pending_json=decrypt_text(row.pending_enc or ""),
        cursors_json=row.cursors_json or "",
    )


@router.put("/sessions/{account_id}/cursors")
def put_cursors(
    account_id: str,
    cursors: dict,
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    _bale_account(db, account_id)
    row = db.query(BaleAuthState).filter(BaleAuthState.account_id == account_id).first()
    if not row:
        row = BaleAuthState(account_id=account_id)
        db.add(row)
    row.cursors_json = json.dumps(cursors or {}, ensure_ascii=False)
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return {"ok": True}


@router.delete("/sessions/{account_id}/auth")
def clear_auth(
    account_id: str,
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    _bale_account(db, account_id)
    row = db.query(BaleAuthState).filter(BaleAuthState.account_id == account_id).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.put("/sessions/{account_id}/pair-state")
def put_pair_state(
    account_id: str,
    pairing_state: str = "",
    status: str = "",
    external_id: str = "",
    label: str = "",
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    acc = _bale_account(db, account_id)
    if pairing_state:
        acc.pairing_state = pairing_state
    if status:
        acc.status = status
    if external_id:
        acc.external_id = normalize_phone_for_storage(external_id) or external_id
    if label:
        acc.label = label
    db.add(acc)
    from app.services.setup_tasks import maybe_complete_setup_tasks_for_account

    maybe_complete_setup_tasks_for_account(db, acc)
    db.commit()
    return {
        "account_id": acc.id,
        "pairing_state": acc.pairing_state,
        "status": acc.status,
        "external_id": acc.external_id or "",
        "label": acc.label or "",
    }


@router.post("/sessions/{account_id}/heartbeat")
def heartbeat(
    account_id: str,
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    acc = _bale_account(db, account_id)
    device_id = f"bale-{account_id}"
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
            role=ConnectorRole.bale,
            status="online",
            last_seen_at=datetime.utcnow(),
        )
        db.add(session)
    else:
        session.last_seen_at = datetime.utcnow()
        session.status = "online"
        session.role = ConnectorRole.bale
        db.add(session)
    acc.status = "online"
    if (acc.pairing_state or "") not in ("otp_pending", "auth_required", "disconnected"):
        acc.pairing_state = "connected"
    db.add(acc)
    from app.services.setup_tasks import maybe_complete_setup_tasks_for_account

    maybe_complete_setup_tasks_for_account(db, acc)
    db.commit()
    return {"ok": True, "session_id": session.id}


@router.post("/sessions/{account_id}/ingest")
def ingest(
    account_id: str,
    body: MessageIngestIn,
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    acc = _bale_account(db, account_id)
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
        allow_divar_api=True,
        allow_bale_api=True,
    )


@router.post("/jobs/claim")
def claim_jobs(
    account_id: str = Query(...),
    limit: int = Query(default=5, ge=1, le=20),
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    acc = _bale_account(db, account_id)
    device_id = f"bale-{account_id}"

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
            role=ConnectorRole.bale,
            status="online",
            last_seen_at=datetime.utcnow(),
        )
        db.add(session)
        db.flush()
    else:
        session.last_seen_at = datetime.utcnow()
        session.status = "online"
        session.role = ConnectorRole.bale
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
    _: None = Depends(require_bale_connector_key),
    db: Session = Depends(get_db),
):
    job = db.get(OutboundJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    acc = db.get(ChannelAccount, job.account_id)
    if not acc or (acc.connector_type or "") != "bale_api":
        raise HTTPException(status_code=400, detail="not a bale_api job")
    job.status = OutboundStatus.sent if ok else OutboundStatus.failed
    job.error = error or ""
    job.updated_at = datetime.utcnow()
    db.add(job)
    if job.lead_id:
        from app.models import Message, MessageDirection
        from app.services.delivery_status import merge_delivery_status

        msg = (
            db.query(Message)
            .filter(
                Message.org_id == job.org_id,
                Message.account_id == job.account_id,
                Message.lead_id == job.lead_id,
                Message.direction == MessageDirection.outbound,
                Message.body == (job.body or ""),
            )
            .order_by(Message.created_at.desc())
            .first()
        )
        if msg and ok:
            msg.delivery_status = merge_delivery_status(
                getattr(msg, "delivery_status", "") or "",
                "sent",
            )
            db.add(msg)
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
        connector="bale_api",
    )
    return {"ok": True}
