"""Public org JWT routes for Divar API pairing (OTP) from the web panel."""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import ChannelAccount, ChannelType, DivarAuthState, MemberRole
from app.schemas import (
    ChannelAccountOut,
    DivarPairCodeIn,
    DivarPairStartIn,
    DivarPairStatusOut,
)
from app.services.divar_auth import DivarAuthError, consume_otp, send_otp
from app.services.wa_crypto import decrypt_text, encrypt_text

router = APIRouter(prefix="/channels", tags=["divar-pair"])


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
        phone=r.external_id or "",
        status=status,
        connector_type=getattr(r, "connector_type", None) or "extension",
        pairing_state=getattr(r, "pairing_state", None) or "disconnected",
        wa_jid="",
    )


def _get_org_account(db: Session, org_id: str, account_id: str) -> ChannelAccount:
    acc = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == account_id, ChannelAccount.org_id == org_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")
    return acc


def _require_divar_api(acc: ChannelAccount) -> None:
    if acc.channel != ChannelType.divar:
        raise HTTPException(status_code=400, detail="فقط دیوار")
    if (acc.connector_type or "") != "divar_api":
        raise HTTPException(status_code=400, detail="این اکانت روی کانکتور سرور دیوار نیست")


def _auth_row(db: Session, account_id: str) -> DivarAuthState:
    row = db.query(DivarAuthState).filter(DivarAuthState.account_id == account_id).first()
    if not row:
        row = DivarAuthState(account_id=account_id)
        db.add(row)
        db.flush()
    return row


def _pair_out(acc: ChannelAccount, *, message: str = "") -> DivarPairStatusOut:
    return DivarPairStatusOut(
        account_id=acc.id,
        pairing_state=acc.pairing_state or "disconnected",
        status=acc.status or "disconnected",
        phone=acc.external_id or "",
        connector_type="divar_api",
        message=message,
    )


@router.post("/accounts/divar-api", response_model=ChannelAccountOut)
def create_divar_api_account(
    label: str = "دیوار",
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = ChannelAccount(
        org_id=auth.org.id,
        channel=ChannelType.divar,
        label=(label or "دیوار").strip() or "دیوار",
        external_id="",
        connector_type="divar_api",
        pairing_state="disconnected",
        status="offline",
        created_at=datetime.utcnow(),
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _account_out(acc, live_online=False)


@router.post("/accounts/{account_id}/divar/pair/start", response_model=DivarPairStatusOut)
def divar_pair_start(
    account_id: str,
    body: DivarPairStartIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    _require_divar_api(acc)
    try:
        pending = send_otp(body.phone)
    except DivarAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    row = _auth_row(db, account_id)
    row.pending_enc = encrypt_text(json.dumps(pending, ensure_ascii=False))
    row.cookies_enc = ""
    db.add(row)

    acc.pairing_state = "otp_pending"
    acc.external_id = pending.get("phone") or ""
    acc.status = "offline"
    acc.qr_payload = ""
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _pair_out(acc, message="کد تأیید به شماره ارسال شد")


@router.post("/accounts/{account_id}/divar/pair/code", response_model=DivarPairStatusOut)
def divar_pair_code(
    account_id: str,
    body: DivarPairCodeIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    _require_divar_api(acc)
    row = _auth_row(db, account_id)
    pending_raw = decrypt_text(row.pending_enc or "")
    if not pending_raw:
        raise HTTPException(status_code=400, detail="ابتدا شماره را ارسال کنید")
    try:
        pending = json.loads(pending_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="نشست OTP نامعتبر است") from exc

    try:
        result = consume_otp(pending, body.code)
    except DivarAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    cookies_blob = {
        "cookies": result["cookies"],
        "user_agent": result.get("user_agent") or "",
        "x_screen_size": result.get("x_screen_size") or "",
        "user_id": result.get("user_id") or "",
        "phone": result.get("phone") or pending.get("phone") or "",
    }
    row.cookies_enc = encrypt_text(json.dumps(cookies_blob, ensure_ascii=False))
    row.pending_enc = ""
    db.add(row)

    acc.pairing_state = "connected"
    acc.status = "online"
    acc.external_id = cookies_blob["phone"] or acc.external_id
    db.add(acc)
    from app.services.setup_tasks import maybe_complete_setup_tasks_for_account

    maybe_complete_setup_tasks_for_account(db, acc)
    db.commit()
    db.refresh(acc)
    return _pair_out(acc, message="دیوار متصل شد")


@router.get("/accounts/{account_id}/divar/pair/status", response_model=DivarPairStatusOut)
def divar_pair_status(
    account_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    return _pair_out(acc)


@router.post("/accounts/{account_id}/divar/pair/logout", response_model=DivarPairStatusOut)
def divar_pair_logout(
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    _require_divar_api(acc)
    acc.pairing_state = "disconnected"
    acc.status = "offline"
    acc.qr_payload = ""
    db.add(acc)
    row = db.query(DivarAuthState).filter(DivarAuthState.account_id == account_id).first()
    if row:
        db.delete(row)
    db.commit()
    db.refresh(acc)
    return _pair_out(acc, message="اتصال قطع شد")
