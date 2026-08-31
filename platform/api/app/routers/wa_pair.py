"""Public org JWT routes for Baileys WhatsApp pairing from the web panel."""

from __future__ import annotations

import random
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, is_demo_org, require_roles
from app.models import ChannelAccount, ChannelType, MemberRole, WaAuthState
from app.schemas import ChannelAccountOut, WaPairCodeStartIn, WaPairStatusOut
from app.services.pair_rate_limit import check_and_record, raise_too_soon
from app.services.phone import ascii_digits, normalize_phone_for_storage, to_cc_digits

router = APIRouter(prefix="/channels", tags=["wa-pair"])


# ---------------------------------------------------------------------------
# Demo mock data — when a demo org asks for groups / participants we return a
# random but realistic list instead of proxying to the (offline) connector.
# ---------------------------------------------------------------------------
_DEMO_GROUP_SUBJECTS = [
    "خریداران آپارتمان نیاوران",
    "گروه اجاره فرمانیه",
    "مشاورین املاک پارامیس",
    "گروه سرمایه‌گذاری غرب تهران",
    "ویلاهای لوکس شمال",
    "مشتریان وفادار پارامیس",
    "گروه بازاریابی منطقه ۱",
    "پشتیبانی فروش آنلاین",
    "گروه معرفی همکاران",
    "رهن کامل — تهران",
]

_DEMO_FIRST = [
    "علی", "محمد", "حسین", "مریم", "زهرا", "سارا", "رضا", "امیر", "نگار", "مهدی",
    "الهه", "پارسا", "شیوا", "آرش", "فرناز", "سامان", "لیلا", "بهنام", "ترانه", "کاوه",
    "نرگس", "کیان", "دنیا", "سهراب", "الهام",
]
_DEMO_LAST = [
    "رضایی", "احمدی", "محمدی", "کریمی", "حسینی", "نوری", "قاسمی", "تقوی", "موسوی",
    "صادقی", "کاظمی", "عباسی", "همتی", "صبوری", "باقری", "نجفی", "توکلی", "مرادی",
]


def _demo_groups() -> list[dict]:
    groups = []
    n = random.randint(3, 6)
    for subject in random.sample(_DEMO_GROUP_SUBJECTS, n):
        groups.append(
            {
                "jid": f"{random.randint(1200000000, 1299999999)}-{random.randint(1000, 9999)}@g.us",
                "subject": subject,
                "size": random.randint(5, 180),
                "owner": "989120000000@c.us" if random.random() < 0.6 else None,
            }
        )
    return groups


def _demo_participants(group_jid: str) -> dict:
    parts = []
    used: set[str] = set()
    for _ in range(random.randint(8, 40)):
        phone = f"9891{random.randint(20000000, 99999999)}"
        while phone in used:
            phone = f"9891{random.randint(20000000, 99999999)}"
        used.add(phone)
        admin = random.choice([None, None, None, "admin", "superadmin"])
        parts.append(
            {
                "id": f"{phone}@s.whatsapp.net",
                "phone": phone,
                "name": f"{random.choice(_DEMO_FIRST)} {random.choice(_DEMO_LAST)}",
                "lid": f"{random.randint(10, 99)}:{random.randint(10, 99)}",
                "admin": admin,
                "is_admin": admin is not None,
            }
        )
    return {
        "subject": "گروه دمو",
        "group_jid": group_jid,
        "participants": parts,
    }


def _digits_phone(raw: str) -> str:
    """Canonical 09… for DB; empty if not a usable number."""
    stored = normalize_phone_for_storage(raw)
    digits = ascii_digits(stored)
    if 8 <= len(digits) <= 15:
        return stored
    return ""


def _pair_status_out(acc: ChannelAccount) -> WaPairStatusOut:
    phone = ""
    if (acc.pairing_state or "") == "code_pending":
        phone = (acc.external_id or "").strip()
    elif acc.external_id and re.fullmatch(r"\d{8,15}", acc.external_id or ""):
        phone = acc.external_id
    return WaPairStatusOut(
        account_id=acc.id,
        pairing_state=acc.pairing_state or "disconnected",
        status=acc.status or "disconnected",
        qr_payload=acc.qr_payload or "",
        wa_jid=acc.wa_jid or "",
        connector_type=acc.connector_type or "extension",
        phone=phone,
    )


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


def _require_baileys_wa(acc: ChannelAccount) -> None:
    if acc.channel != ChannelType.whatsapp:
        raise HTTPException(status_code=400, detail="فقط واتساپ قابل جفت‌سازی است")
    if (acc.connector_type or "extension") != "baileys":
        raise HTTPException(status_code=400, detail="این اکانت روی Baileys نیست")


@router.post("/accounts/{account_id}/pair/start", response_model=WaPairStatusOut)
def pair_start(
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    _require_baileys_wa(acc)
    # QR pairing has no phone in the body, so the rate-limit key is the
    # account itself (one WhatsApp number per account). This stops the user
    # from repeatedly asking the sidecar to mint new QR codes back-to-back.
    allowed, retry = check_and_record("whatsapp", account_id)
    if not allowed:
        raise_too_soon("whatsapp", retry)
    acc.pairing_state = "qr_pending"
    acc.qr_payload = ""
    acc.status = "offline"
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _pair_status_out(acc)


@router.post("/accounts/{account_id}/pair/code/start", response_model=WaPairStatusOut)
def pair_code_start(
    account_id: str,
    body: WaPairCodeStartIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    """Start pairing-code flow: panel provides phone; connector puts 8-digit code in qr_payload."""
    acc = _get_org_account(db, auth.org.id, account_id)
    _require_baileys_wa(acc)
    phone = _digits_phone(body.phone)
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="شماره را با کد کشور وارد کنید (مثلاً 98912… یا 0912…)",
        )
    # Rate-limit per phone (same number across +98 / 0912 / Persian digits
    # all collapse to the same bucket via to_cc_digits).
    cc_digits = to_cc_digits(phone)
    allowed, retry = check_and_record("whatsapp", cc_digits)
    if not allowed:
        raise_too_soon("whatsapp", retry)
    # Fresh pair — wipe auth so Baileys issues a new code
    row = db.query(WaAuthState).filter(WaAuthState.account_id == account_id).first()
    if row:
        db.delete(row)
    acc.pairing_state = "code_pending"
    acc.qr_payload = ""
    acc.status = "offline"
    acc.external_id = phone
    acc.wa_jid = ""
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _pair_status_out(acc)


@router.get("/accounts/{account_id}/pair/status", response_model=WaPairStatusOut)
def pair_status(
    account_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    acc = _get_org_account(db, auth.org.id, account_id)
    return _pair_status_out(acc)


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
    return _pair_status_out(acc)


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
    if is_demo_org(auth.org):
        return {"groups": _demo_groups()}
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
    if is_demo_org(auth.org):
        return _demo_participants(group_jid)
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
