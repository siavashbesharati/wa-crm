"""Public org JWT routes for Baileys WhatsApp pairing from the web panel."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import ChannelAccount, ChannelType, MemberRole, WaAuthState
from app.schemas import ChannelAccountOut, WaPairStatusOut

router = APIRouter(prefix="/channels", tags=["wa-pair"])


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


def _get_org_account(db: Session, org_id: str, account_id: str) -> ChannelAccount:
    acc = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == account_id, ChannelAccount.org_id == org_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")
    return acc


@router.post("/accounts/{account_id}/pair/start", response_model=WaPairStatusOut)
def pair_start(
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    if acc.channel != ChannelType.whatsapp:
        raise HTTPException(status_code=400, detail="فقط واتساپ قابل جفت‌سازی است")
    if (acc.connector_type or "extension") != "baileys":
        raise HTTPException(status_code=400, detail="این اکانت روی Baileys نیست")
    acc.pairing_state = "qr_pending"
    acc.qr_payload = ""
    acc.status = "offline"
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return WaPairStatusOut(
        account_id=acc.id,
        pairing_state=acc.pairing_state,
        status=acc.status or "offline",
        qr_payload="",
        wa_jid=acc.wa_jid or "",
        connector_type="baileys",
    )


@router.get("/accounts/{account_id}/pair/status", response_model=WaPairStatusOut)
def pair_status(
    account_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    return WaPairStatusOut(
        account_id=acc.id,
        pairing_state=acc.pairing_state or "disconnected",
        status=acc.status or "disconnected",
        qr_payload=acc.qr_payload or "",
        wa_jid=acc.wa_jid or "",
        connector_type=acc.connector_type or "extension",
    )


@router.post("/accounts/{account_id}/pair/logout", response_model=WaPairStatusOut)
def pair_logout(
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    if (acc.connector_type or "extension") != "baileys":
        raise HTTPException(status_code=400, detail="این اکانت روی Baileys نیست")
    acc.pairing_state = "disconnected"
    acc.qr_payload = ""
    acc.status = "offline"
    acc.wa_jid = ""
    db.add(acc)
    row = db.query(WaAuthState).filter(WaAuthState.account_id == account_id).first()
    if row:
        db.delete(row)
    db.commit()
    db.refresh(acc)
    return WaPairStatusOut(
        account_id=acc.id,
        pairing_state="disconnected",
        status="offline",
        qr_payload="",
        wa_jid="",
        connector_type="baileys",
    )


@router.post("/accounts/baileys", response_model=ChannelAccountOut)
def create_baileys_account(
    label: str = "واتساپ",
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    """Create a WhatsApp ChannelAccount bound to the Baileys sidecar."""
    acc = ChannelAccount(
        org_id=auth.org.id,
        channel=ChannelType.whatsapp,
        label=(label or "واتساپ").strip() or "واتساپ",
        external_id="",
        connector_type="baileys",
        pairing_state="disconnected",
        status="offline",
        created_at=datetime.utcnow(),
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _account_out(acc, live_online=False)


@router.get("/accounts/{account_id}/groups")
def list_groups(
    account_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    """Proxy to wa-connector group list."""
    acc = _get_org_account(db, auth.org.id, account_id)
    if (acc.connector_type or "") != "baileys":
        raise HTTPException(status_code=400, detail="فقط اکانت Baileys")
    if (acc.pairing_state or "") != "connected" and (acc.status or "") != "online":
        raise HTTPException(status_code=409, detail="واتساپ متصل نیست")
    import httpx

    try:
        r = httpx.get(f"http://127.0.0.1:8090/groups/{account_id}", timeout=45.0)
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=r.text[:300] or "connector error")
        return r.json()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"wa-connector unreachable: {exc}") from exc


@router.get("/accounts/{account_id}/groups/participants")
def group_participants(
    account_id: str,
    jid: str = Query(..., min_length=5, description="Group JID e.g. 120…@g.us"),
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    """Export group participants via Baileys."""
    acc = _get_org_account(db, auth.org.id, account_id)
    if (acc.connector_type or "") != "baileys":
        raise HTTPException(status_code=400, detail="فقط اکانت Baileys")
    group_jid = (jid or "").strip()
    if "@g.us" not in group_jid:
        raise HTTPException(status_code=400, detail="jid گروه نامعتبر است")
    import httpx
    from urllib.parse import quote

    try:
        r = httpx.get(
            f"http://127.0.0.1:8090/groups/{account_id}/participants?jid={quote(group_jid, safe='')}",
            timeout=60.0,
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=r.text[:300] or "connector error")
        return r.json()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"wa-connector unreachable: {exc}") from exc
