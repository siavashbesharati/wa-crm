"""Public org JWT routes for Bale pairing (phone + OTP) from the web panel."""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import BaleAuthState, ChannelAccount, ChannelType, MemberRole
from app.schemas import (
    BalePairCodeIn,
    BalePairStartIn,
    BalePairStatusOut,
    ChannelAccountOut,
)
from app.services.bale_auth import (
    BaleAuthError,
    format_phone_display,
    start_phone_auth,
    validate_code,
)
from app.services.wa_crypto import decrypt_text, encrypt_text

router = APIRouter(prefix="/channels", tags=["bale-pair"])


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
        connector_type=getattr(r, "connector_type", None) or "bale_api",
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


def _require_bale_api(acc: ChannelAccount) -> None:
    if acc.channel != ChannelType.bale:
        raise HTTPException(status_code=400, detail="فقط بله")
    if (acc.connector_type or "") != "bale_api":
        raise HTTPException(status_code=400, detail="این اکانت روی کانکتور سرور بله نیست")


def _auth_row(db: Session, account_id: str) -> BaleAuthState:
    row = db.query(BaleAuthState).filter(BaleAuthState.account_id == account_id).first()
    if not row:
        row = BaleAuthState(account_id=account_id)
        db.add(row)
        db.flush()
    return row


def _session_public_meta(row: BaleAuthState | None) -> tuple[str, str]:
    """Display name / user id from encrypted blob — never return the token."""
    if not row or not (row.token_enc or "").strip():
        return "", ""
    try:
        blob = json.loads(decrypt_text(row.token_enc or "") or "{}")
    except Exception:  # noqa: BLE001
        return "", ""
    if not isinstance(blob, dict):
        return "", ""
    name = str(blob.get("user_name") or "").strip()
    uid = str(blob.get("user_id") or "").strip()
    if uid == "0":
        uid = ""
    return name, uid


def _pair_out(
    acc: ChannelAccount,
    *,
    message: str = "",
    sent_code_type: int | None = None,
    display_name: str = "",
    user_id: str = "",
) -> BalePairStatusOut:
    return BalePairStatusOut(
        account_id=acc.id,
        pairing_state=acc.pairing_state or "disconnected",
        status=acc.status or "disconnected",
        phone=format_phone_display(acc.external_id or ""),
        display_name=display_name,
        user_id=user_id,
        connector_type="bale_api",
        sent_code_type=sent_code_type,
        message=message,
    )


@router.post("/accounts/bale-api", response_model=ChannelAccountOut)
def create_bale_api_account(
    label: str = "بله",
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = ChannelAccount(
        org_id=auth.org.id,
        channel=ChannelType.bale,
        label=(label or "بله").strip() or "بله",
        external_id="",
        connector_type="bale_api",
        pairing_state="disconnected",
        status="offline",
        created_at=datetime.utcnow(),
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _account_out(acc, live_online=False)


@router.post("/accounts/{account_id}/bale/pair/start", response_model=BalePairStatusOut)
def bale_pair_start(
    account_id: str,
    body: BalePairStartIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    _require_bale_api(acc)
    try:
        pending = start_phone_auth(body.phone)
    except BaleAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    row = _auth_row(db, account_id)
    row.pending_enc = encrypt_text(json.dumps(pending, ensure_ascii=False))
    row.token_enc = ""
    db.add(row)

    acc.pairing_state = "otp_pending"
    acc.external_id = pending.get("phone") or ""
    acc.status = "offline"
    acc.qr_payload = ""
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _pair_out(
        acc,
        message="کد ورود به برنامه بله شما ارسال شده است. آن را اینجا وارد کنید.",
        sent_code_type=int(pending.get("sent_code_type") or 0) or None,
    )


@router.post("/accounts/{account_id}/bale/pair/code", response_model=BalePairStatusOut)
def bale_pair_code(
    account_id: str,
    body: BalePairCodeIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    _require_bale_api(acc)
    row = _auth_row(db, account_id)
    pending_raw = decrypt_text(row.pending_enc or "")
    if not pending_raw:
        raise HTTPException(status_code=400, detail="ابتدا شماره را ارسال کنید")
    try:
        pending = json.loads(pending_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="نشست OTP نامعتبر است") from exc

    try:
        result = validate_code(pending, body.code)
    except BaleAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    session_blob = {
        "access_token": result["access_token"],
        "user_id": result.get("user_id") or 0,
        "user_name": result.get("user_name") or "",
        "phone": result.get("phone") or pending.get("phone") or "",
    }
    row.token_enc = encrypt_text(json.dumps(session_blob, ensure_ascii=False))
    row.pending_enc = ""
    db.add(row)

    display_name = str(session_blob.get("user_name") or "").strip()
    user_id = str(session_blob.get("user_id") or "").strip()
    if user_id == "0":
        user_id = ""
    acc.pairing_state = "connected"
    acc.status = "online"
    acc.external_id = session_blob["phone"] or acc.external_id
    if display_name:
        acc.label = display_name
    db.add(acc)
    from app.services.setup_tasks import maybe_complete_setup_tasks_for_account

    maybe_complete_setup_tasks_for_account(db, acc)
    db.commit()
    db.refresh(acc)
    return _pair_out(
        acc,
        message="بله متصل شد",
        display_name=display_name,
        user_id=user_id,
    )


@router.get("/accounts/{account_id}/bale/pair/status", response_model=BalePairStatusOut)
def bale_pair_status(
    account_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    row = db.query(BaleAuthState).filter(BaleAuthState.account_id == account_id).first()
    name, uid = _session_public_meta(row)
    return _pair_out(acc, display_name=name, user_id=uid)


@router.post("/accounts/{account_id}/bale/pair/logout", response_model=BalePairStatusOut)
def bale_pair_logout(
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    _require_bale_api(acc)
    acc.pairing_state = "disconnected"
    acc.status = "offline"
    acc.qr_payload = ""
    db.add(acc)
    row = db.query(BaleAuthState).filter(BaleAuthState.account_id == account_id).first()
    if row:
        db.delete(row)
    db.commit()
    db.refresh(acc)
    return _pair_out(acc, message="اتصال قطع شد")
