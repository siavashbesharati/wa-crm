from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import ChannelAccount, ChannelType, ConnectorRole, ConnectorSession, InstagramAuthState
from app.schemas import InstagramAuthStateOut, InstagramEventIn
from app.services.wa_crypto import decrypt_text, encrypt_text

router = APIRouter(prefix="/internal/instagram", tags=["instagram-connector-internal"])


def require_instagram_connector_key(
    x_connector_key: str | None = Header(default=None, alias="X-Connector-Key"),
) -> None:
    expected = get_settings().instagram_connector_key.strip()
    if not expected or not x_connector_key or x_connector_key.strip() != expected:
        raise HTTPException(status_code=401, detail="invalid connector key")


def _account(db: Session, account_id: str) -> ChannelAccount:
    account = db.get(ChannelAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="account not found")
    if account.channel != ChannelType.instagram or account.connector_type != "instagram_api":
        raise HTTPException(status_code=400, detail="account is not an instagram_api connector")
    return account


@router.get("/sessions")
def list_sessions(
    _: None = Depends(require_instagram_connector_key),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ChannelAccount)
        .filter(
            ChannelAccount.channel == ChannelType.instagram,
            ChannelAccount.connector_type == "instagram_api",
        )
        .order_by(ChannelAccount.created_at.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "org_id": row.org_id,
            "label": row.label,
            "external_id": row.external_id or "",
            "pairing_state": row.pairing_state or "disconnected",
            "status": row.status or "disconnected",
        }
        for row in rows
    ]


@router.get("/sessions/{account_id}/auth", response_model=InstagramAuthStateOut)
def get_auth(
    account_id: str,
    _: None = Depends(require_instagram_connector_key),
    db: Session = Depends(get_db),
):
    _account(db, account_id)
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account_id).first()
    if not row:
        return InstagramAuthStateOut(account_id=account_id)
    return InstagramAuthStateOut(
        account_id=account_id,
        pending_json=decrypt_text(row.pending_enc or ""),
        cursors_json=row.cursors_json or "",
    )


@router.get("/sessions/{account_id}/settings")
def get_settings_blob(
    account_id: str,
    _: None = Depends(require_instagram_connector_key),
    db: Session = Depends(get_db),
):
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account_id).first()
    _account(db, account_id)
    if not row:
        return {"settings_json": "", "credentials_json": ""}
    return {
        "settings_json": decrypt_text(row.settings_enc or ""),
        "credentials_json": decrypt_text(row.credentials_enc or ""),
        "pending_json": decrypt_text(row.pending_enc or ""),
    }


@router.put("/sessions/{account_id}/state")
def put_state(
    account_id: str,
    body: dict,
    _: None = Depends(require_instagram_connector_key),
    db: Session = Depends(get_db),
):
    account = _account(db, account_id)
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account_id).first()
    if not row:
        row = InstagramAuthState(account_id=account_id)
        db.add(row)
    for key, field in (("settings_json", "settings_enc"), ("credentials_json", "credentials_enc"), ("pending_json", "pending_enc")):
        if key in body:
            setattr(row, field, encrypt_text(str(body.get(key) or "")))
    if "profile" in body:
        row.profile_json = json.dumps(body.get("profile") or {}, ensure_ascii=False)
    if "cursors" in body:
        row.cursors_json = json.dumps(body.get("cursors") or {}, ensure_ascii=False)
    if body.get("pairing_state"):
        account.pairing_state = str(body["pairing_state"])
    if body.get("status"):
        account.status = str(body["status"])
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.add(account)
    db.commit()
    return {"ok": True}


@router.post("/sessions/{account_id}/heartbeat")
def heartbeat(
    account_id: str,
    _: None = Depends(require_instagram_connector_key),
    db: Session = Depends(get_db),
):
    account = _account(db, account_id)
    device_id = f"instagram-{account_id}"
    session = (
        db.query(ConnectorSession)
        .filter(
            ConnectorSession.org_id == account.org_id,
            ConnectorSession.account_id == account_id,
            ConnectorSession.device_id == device_id,
        )
        .first()
    )
    if not session:
        session = ConnectorSession(
            org_id=account.org_id,
            account_id=account_id,
            device_id=device_id,
            role=ConnectorRole.instagram,
        )
        db.add(session)
    session.status = "online"
    session.role = ConnectorRole.instagram
    session.last_seen_at = datetime.utcnow()
    account.status = "online"
    db.add(session)
    db.add(account)
    db.commit()
    return {"ok": True, "session_id": session.id}


@router.post("/sessions/{account_id}/events")
def ingest_event(
    account_id: str,
    body: InstagramEventIn,
    _: None = Depends(require_instagram_connector_key),
    db: Session = Depends(get_db),
):
    account = _account(db, account_id)
    if body.event_type not in ("dm", "comment", "comment_reply"):
        raise HTTPException(status_code=400, detail="unsupported Instagram event type")
    from app.services.instagram_automation import ingest_event

    return ingest_event(db, account=account, body=body)
