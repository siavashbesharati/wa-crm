"""Extension seat tokens — concurrent Chrome installs per plan."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import ExtensionSeat, MemberRole, Membership, Organization, User
from app.plans import plan_limits
from app.schemas import TokenOut
from app.services.seat_tokens import hash_token, new_raw_token
from app.services.security import create_access_token, create_refresh_token

router = APIRouter(prefix="/seats", tags=["seats"])


def _seat_out(seat: ExtensionSeat, *, include_raw: str | None = None) -> dict:
    token = include_raw or getattr(seat, "token_plain", None) or ""
    data = {
        "id": seat.id,
        "label": seat.label,
        "token_prefix": seat.token_prefix,
        "token": token,
        "status": seat.status,
        "bound_install_id": seat.bound_install_id or "",
        "bound_device_id": seat.bound_device_id or "",
        "bound_at": seat.bound_at.isoformat() + "Z" if seat.bound_at else None,
        "last_seen_at": seat.last_seen_at.isoformat() + "Z" if seat.last_seen_at else None,
        "created_at": seat.created_at.isoformat() + "Z" if seat.created_at else None,
    }
    return data


class SeatCreateIn(BaseModel):
    label: str = ""


class SeatActivateIn(BaseModel):
    token: str = Field(min_length=10)
    install_id: str = Field(min_length=8)
    device_id: str = ""
    label_hint: str = ""


@router.get("")
def list_seats(
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    limits = plan_limits(auth.org.plan)
    rows = (
        db.query(ExtensionSeat)
        .filter(ExtensionSeat.org_id == auth.org.id, ExtensionSeat.status != "revoked")
        .order_by(ExtensionSeat.created_at.desc())
        .all()
    )
    # Agents only see summary counts; owners/admins see full list
    if auth.role == MemberRole.agent:
        return {
            "max_seats": limits["max_seats"],
            "used": len(rows),
            "locked": sum(1 for r in rows if r.status == "locked"),
            "available": sum(1 for r in rows if r.status == "available"),
            "seats": [],
        }
    return {
        "max_seats": limits["max_seats"],
        "used": len(rows),
        "locked": sum(1 for r in rows if r.status == "locked"),
        "available": sum(1 for r in rows if r.status == "available"),
        "seats": [_seat_out(r) for r in rows],
    }


@router.post("")
def create_seat(
    body: SeatCreateIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    limits = plan_limits(auth.org.plan)
    active = (
        db.query(ExtensionSeat)
        .filter(ExtensionSeat.org_id == auth.org.id, ExtensionSeat.status != "revoked")
        .count()
    )
    if active >= limits["max_seats"]:
        raise HTTPException(
            status_code=402,
            detail=f"سقف صندلی افزونه پلن پر است (حداکثر {limits['max_seats']})",
        )

    raw = new_raw_token()
    seat = ExtensionSeat(
        org_id=auth.org.id,
        label=(body.label or f"صندلی {active + 1}").strip(),
        token_prefix=raw[:12],
        token_hash=hash_token(raw),
        token_plain=raw,
        status="available",
        created_by_user_id=auth.user.id,
    )
    db.add(seat)
    db.commit()
    db.refresh(seat)
    return _seat_out(seat)


@router.post("/{seat_id}/reset")
def reset_seat(
    seat_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    """Unlock seat so another extension install can use the same token again."""
    seat = (
        db.query(ExtensionSeat)
        .filter(ExtensionSeat.id == seat_id, ExtensionSeat.org_id == auth.org.id)
        .first()
    )
    if not seat or seat.status == "revoked":
        raise HTTPException(status_code=404, detail="صندلی یافت نشد")
    seat.status = "available"
    seat.bound_install_id = ""
    seat.bound_device_id = ""
    seat.bound_at = None
    seat.last_seen_at = None
    db.add(seat)
    db.commit()
    db.refresh(seat)
    return _seat_out(seat)


@router.delete("/{seat_id}")
def revoke_seat(
    seat_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    seat = (
        db.query(ExtensionSeat)
        .filter(ExtensionSeat.id == seat_id, ExtensionSeat.org_id == auth.org.id)
        .first()
    )
    if not seat:
        raise HTTPException(status_code=404, detail="صندلی یافت نشد")
    seat.status = "revoked"
    seat.bound_install_id = ""
    seat.bound_device_id = ""
    db.add(seat)
    db.commit()
    return {"ok": True, "id": seat_id}


@router.post("/activate", response_model=TokenOut)
def activate_seat(body: SeatActivateIn, db: Session = Depends(get_db)):
    """Bind a seat token to this Chrome install and issue org JWT."""
    raw = body.token.strip()
    install_id = body.install_id.strip()
    device_id = (body.device_id or install_id).strip()
    if len(raw) < 10 or len(install_id) < 8:
        raise HTTPException(status_code=400, detail="توکن یا شناسه نصب نامعتبر است")

    seat = db.query(ExtensionSeat).filter(ExtensionSeat.token_hash == hash_token(raw)).first()
    if not seat or seat.status == "revoked":
        raise HTTPException(status_code=404, detail="توکن افزونه یافت نشد یا لغو شده است")

    org = db.get(Organization, seat.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="سازمان یافت نشد")
    if getattr(org, "status", "active") == "suspended":
        raise HTTPException(status_code=403, detail="این کسب‌وکار موقتاً غیرفعال است")

    if seat.status == "locked":
        if seat.bound_install_id and seat.bound_install_id != install_id:
            raise HTTPException(
                status_code=409,
                detail="این توکن قبلاً روی افزونه/دستگاه دیگری قفل شده است. مدیر باید آن را ریست کند یا توکن جدید بسازد.",
            )
    else:
        # First bind
        seat.status = "locked"
        seat.bound_install_id = install_id
        seat.bound_device_id = device_id
        seat.bound_at = datetime.utcnow()
        if body.label_hint.strip() and not seat.label:
            seat.label = body.label_hint.strip()

    seat.last_seen_at = datetime.utcnow()
    db.add(seat)

    # Prefer an owner membership for JWT subject; else any member
    membership = (
        db.query(Membership)
        .filter(Membership.org_id == org.id, Membership.role == MemberRole.owner)
        .order_by(Membership.created_at.asc())
        .first()
    )
    if not membership:
        membership = db.query(Membership).filter(Membership.org_id == org.id).first()
    if not membership:
        raise HTTPException(status_code=404, detail="عضویت سازمان یافت نشد")

    user = db.get(User, membership.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="کاربر یافت نشد")

    db.commit()

    access = create_access_token(
        user.id,
        org.id,
        "agent",  # extension seat acts as agent/connector
        scope="org",
        seat_id=seat.id,
        install_id=install_id,
    )
    refresh = create_refresh_token(db, user.id)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        user_id=user.id,
        org_id=org.id,
        role="agent",
        is_new=False,
        onboarding_step=getattr(org, "onboarding_step", None) or "done",
    )


@router.post("/heartbeat")
def seat_heartbeat(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    if not auth.seat:
        return {"ok": True, "seat": None}
    auth.seat.last_seen_at = datetime.utcnow()
    if auth.seat.status == "available":
        # shouldn't happen while JWT has seat_id, but heal
        auth.seat.status = "locked"
    db.add(auth.seat)
    db.commit()
    return {"ok": True, "seat": _seat_out(auth.seat)}
