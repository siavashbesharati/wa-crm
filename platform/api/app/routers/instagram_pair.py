from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import ChannelAccount, ChannelType, InstagramAuthState, MemberRole
from app.schemas import (
    InstagramPairStartIn,
    InstagramPairStatusOut,
    InstagramVerificationIn,
)
from app.services.wa_crypto import decrypt_text, encrypt_text

router = APIRouter(prefix="/channels/accounts", tags=["instagram-pair"])


def _account(db: Session, org_id: str, account_id: str) -> ChannelAccount:
    account = (
        db.query(ChannelAccount)
        .filter(
            ChannelAccount.id == account_id,
            ChannelAccount.org_id == org_id,
            ChannelAccount.channel == ChannelType.instagram,
            ChannelAccount.connector_type == "instagram_api",
        )
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="اکانت اینستاگرام یافت نشد")
    return account


def _profile(row: InstagramAuthState | None) -> dict:
    if not row or not row.profile_json:
        return {}
    try:
        value = json.loads(row.profile_json)
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def _status(account: ChannelAccount, row: InstagramAuthState | None) -> InstagramPairStatusOut:
    profile = _profile(row)
    return InstagramPairStatusOut(
        account_id=account.id,
        pairing_state=account.pairing_state or "disconnected",
        status=account.status or "disconnected",
        username=str(profile.get("username") or account.external_id or ""),
        user_id=str(profile.get("pk") or profile.get("user_id") or ""),
        full_name=str(profile.get("full_name") or ""),
        profile_pic_url=str(profile.get("profile_pic_url") or ""),
        message=str(profile.get("message") or ""),
    )


@router.post("/{account_id}/instagram/pair/start", response_model=InstagramPairStatusOut)
def pair_start(
    account_id: str,
    body: InstagramPairStartIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    account = _account(db, auth.org.id, account_id)
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account.id).first()
    if not row:
        row = InstagramAuthState(account_id=account.id)
        db.add(row)
    row.pending_enc = encrypt_text(json.dumps({"username": body.username, "password": body.password}))
    row.updated_at = datetime.utcnow()
    account.external_id = body.username
    account.label = account.label or f"@{body.username}"
    account.status = "offline"
    account.pairing_state = "authenticating"
    db.add(account)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _status(account, row)


@router.post("/{account_id}/instagram/pair/verify", response_model=InstagramPairStatusOut)
def pair_verify(
    account_id: str,
    body: InstagramVerificationIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    account = _account(db, auth.org.id, account_id)
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account.id).first()
    if not row:
        raise HTTPException(status_code=409, detail="ورود اینستاگرام شروع نشده است")
    pending = {}
    try:
        pending = json.loads(decrypt_text(row.pending_enc or ""))
    except (TypeError, ValueError):
        pending = {}
    pending["verification_code"] = body.code.strip()
    row.pending_enc = encrypt_text(json.dumps(pending))
    account.pairing_state = "authenticating"
    account.status = "offline"
    db.add(row)
    db.add(account)
    db.commit()
    return _status(account, row)


@router.get("/{account_id}/instagram/pair/status", response_model=InstagramPairStatusOut)
def pair_status(
    account_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    account = _account(db, auth.org.id, account_id)
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account.id).first()
    return _status(account, row)


@router.post("/{account_id}/instagram/pair/logout", response_model=InstagramPairStatusOut)
def pair_logout(
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    account = _account(db, auth.org.id, account_id)
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account.id).first()
    if row:
        db.delete(row)
    account.status = "offline"
    account.pairing_state = "disconnected"
    db.add(account)
    db.commit()
    return _status(account, None)
