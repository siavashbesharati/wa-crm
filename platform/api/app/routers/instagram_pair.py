"""Public org JWT routes for Instagram session-ID pairing."""

from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import ChannelAccount, ChannelType, InstagramAuthState, MemberRole
from app.schemas import (
    ChannelAccountOut,
    InstagramPairStartIn,
    InstagramPairStatusOut,
)
from app.services.instagram_auth import (
    InstagramAuthError,
    InstagramRateLimited,
    validate_session,
)
from app.services.wa_crypto import decrypt_text, encrypt_text

router = APIRouter(prefix="/channels", tags=["instagram-pair"])


def _account_out(account: ChannelAccount) -> ChannelAccountOut:
    return ChannelAccountOut(
        id=account.id,
        channel=account.channel.value,
        label=account.label,
        external_id=account.external_id or "",
        phone="",
        status=account.status or "disconnected",
        connector_type="instagram_api",
        pairing_state=account.pairing_state or "disconnected",
        wa_jid="",
    )


def _get_account(db: Session, org_id: str, account_id: str) -> ChannelAccount:
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


def _auth_row(db: Session, account_id: str) -> InstagramAuthState:
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account_id).first()
    if not row:
        row = InstagramAuthState(account_id=account_id)
        db.add(row)
        db.flush()
    return row


def _status(account: ChannelAccount, row: InstagramAuthState | None, message: str = ""):
    return InstagramPairStatusOut(
        account_id=account.id,
        pairing_state=account.pairing_state or "disconnected",
        status=account.status or "disconnected",
        username=(row.username if row else "") or "",
        user_id=(row.user_id if row else "") or "",
        connector_type="instagram_api",
        message=message,
    )


@router.post("/accounts/instagram-api", response_model=ChannelAccountOut)
def create_instagram_account(
    label: str = "اینستاگرام",
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    account = ChannelAccount(
        org_id=auth.org.id,
        channel=ChannelType.instagram,
        label=(label or "اینستاگرام").strip() or "اینستاگرام",
        external_id="",
        connector_type="instagram_api",
        pairing_state="disconnected",
        status="offline",
        created_at=datetime.utcnow(),
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return _account_out(account)


@router.post("/accounts/{account_id}/instagram/pair/start", response_model=InstagramPairStatusOut)
def instagram_pair_start(
    account_id: str,
    body: InstagramPairStartIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    account = _get_account(db, auth.org.id, account_id)
    account.pairing_state = "connecting"
    account.status = "offline"
    db.add(account)
    db.commit()
    import logging as _logging

    _log = _logging.getLogger("instagram-pair")
    try:
        username, user_id = asyncio.run(validate_session(body.session_id.strip()))
    except InstagramRateLimited as exc:
        _log.warning("[Instagram] pair/start rate limited: %s", exc)
        account.pairing_state = "connecting"
        account.status = "offline"
        db.add(account)
        db.commit()
        raise HTTPException(
            status_code=429,
            detail="اینستاگرام موقتاً درخواست‌ها را محدود کرده — چند دقیقه بعد دوباره تلاش کنید.",
        ) from exc
    except InstagramAuthError as exc:
        _log.warning("[Instagram] pair/start auth error: %s: %s", type(exc).__name__, exc)
        account.pairing_state = "auth_required"
        account.status = "offline"
        db.add(account)
        db.commit()
        raise HTTPException(status_code=400, detail="Instagram session is invalid or expired.") from exc
    except Exception as exc:  # noqa: BLE001
        account.pairing_state = "error"
        account.status = "offline"
        db.add(account)
        db.commit()
        raise HTTPException(status_code=502, detail="Instagram connection failed.") from exc

    row = _auth_row(db, account_id)
    row.session_id_enc = encrypt_text(body.session_id.strip())
    row.username = username
    row.user_id = user_id
    row.updated_at = datetime.utcnow()
    account.label = f"@{username}" if username else account.label
    account.external_id = user_id
    account.pairing_state = "connected"
    account.status = "online"
    db.add(row)
    db.add(account)
    db.commit()
    db.refresh(account)
    return _status(account, row, "اینستاگرام متصل شد")


@router.get("/accounts/{account_id}/instagram/pair/status", response_model=InstagramPairStatusOut)
def instagram_pair_status(
    account_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    account = _get_account(db, auth.org.id, account_id)
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account_id).first()
    return _status(account, row)


@router.post("/accounts/{account_id}/instagram/pair/logout", response_model=InstagramPairStatusOut)
def instagram_pair_logout(
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    account = _get_account(db, auth.org.id, account_id)
    row = db.query(InstagramAuthState).filter(InstagramAuthState.account_id == account_id).first()
    if row:
        db.delete(row)
    account.pairing_state = "disconnected"
    account.status = "offline"
    account.external_id = ""
    db.add(account)
    db.commit()
    return _status(account, None, "اتصال اینستاگرام قطع شد")
