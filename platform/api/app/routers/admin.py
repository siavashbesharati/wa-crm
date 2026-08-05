"""Public super-admin endpoints for local/dev (no login)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    AiPolicy,
    ChannelAccount,
    ChannelType,
    MemberRole,
    Membership,
    Organization,
    User,
)
from app.plans import PLANS, plan_limits
from app.schemas import TokenOut
from app.services.security import create_access_token, create_refresh_token

router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()


def _normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit() or ch == "+")


def _ensure_dev() -> None:
    if settings.app_env == "production":
        raise HTTPException(status_code=403, detail="ادمین عمومی فقط در حالت توسعه فعال است")


class BusinessIn(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(min_length=8)
    plan: str = "growth"
    display_name: str = ""


class BusinessOut(BaseModel):
    org_id: str
    name: str
    plan: str
    owner_phone: str
    owner_name: str
    limits: dict


class EnterIn(BaseModel):
    org_id: str = ""
    phone: str = ""


@router.get("/businesses", response_model=list[BusinessOut])
def list_businesses(db: Session = Depends(get_db)):
    _ensure_dev()
    rows = (
        db.query(Organization, Membership, User)
        .join(Membership, Membership.org_id == Organization.id)
        .join(User, User.id == Membership.user_id)
        .filter(Membership.role == MemberRole.owner)
        .order_by(Organization.created_at.desc())
        .all()
    )
    out: list[BusinessOut] = []
    seen: set[str] = set()
    for org, _m, user in rows:
        if org.id in seen:
            continue
        seen.add(org.id)
        out.append(
            BusinessOut(
                org_id=org.id,
                name=org.name,
                plan=org.plan,
                owner_phone=user.phone,
                owner_name=user.display_name or user.phone,
                limits=plan_limits(org.plan),
            )
        )
    return out


@router.post("/businesses", response_model=BusinessOut)
def create_business(body: BusinessIn, db: Session = Depends(get_db)):
    _ensure_dev()
    phone = _normalize_phone(body.phone)
    if len(phone) < 8:
        raise HTTPException(status_code=400, detail="شماره موبایل نامعتبر است")
    plan = body.plan if body.plan in PLANS else "growth"
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="نام کسب‌وکار لازم است")

    existing = db.query(User).filter(User.phone == phone).first()
    if existing:
        raise HTTPException(status_code=400, detail="این شماره از قبل ثبت شده است")

    user = User(phone=phone, display_name=(body.display_name or name).strip() or phone)
    org = Organization(name=name, plan=plan)
    db.add(user)
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=user.id, role=MemberRole.owner))
    db.add(AiPolicy(org_id=org.id, auto_send_enabled=False, min_confidence=0.55))
    db.add(
        ChannelAccount(
            org_id=org.id,
            channel=ChannelType.whatsapp,
            label="واتساپ",
            external_id=phone,
            status="disconnected",
        )
    )
    db.add(
        ChannelAccount(
            org_id=org.id,
            channel=ChannelType.divar,
            label="دیوار",
            external_id="divar-" + phone[-4:],
            status="disconnected",
        )
    )
    db.commit()
    return BusinessOut(
        org_id=org.id,
        name=org.name,
        plan=org.plan,
        owner_phone=user.phone,
        owner_name=user.display_name,
        limits=plan_limits(org.plan),
    )


@router.post("/enter", response_model=TokenOut)
def enter_business(body: EnterIn, db: Session = Depends(get_db)):
    """Issue owner tokens without OTP — public super-admin for local/dev."""
    _ensure_dev()
    org = None
    user = None
    if body.org_id:
        org = db.get(Organization, body.org_id)
        if not org:
            raise HTTPException(status_code=404, detail="کسب‌وکار یافت نشد")
        membership = (
            db.query(Membership)
            .filter(Membership.org_id == org.id, Membership.role == MemberRole.owner)
            .first()
        )
        if not membership:
            raise HTTPException(status_code=404, detail="مالک کسب‌وکار یافت نشد")
        user = db.get(User, membership.user_id)
    else:
        phone = _normalize_phone(body.phone)
        user = db.query(User).filter(User.phone == phone).first()
        if not user:
            raise HTTPException(status_code=404, detail="این شماره در سیستم ثبت نشده است")
        membership = (
            db.query(Membership)
            .filter(Membership.user_id == user.id, Membership.role == MemberRole.owner)
            .first()
        )
        if not membership:
            membership = db.query(Membership).filter(Membership.user_id == user.id).first()
        if not membership:
            raise HTTPException(status_code=404, detail="کسب‌وکاری برای این شماره نیست")
        org = db.get(Organization, membership.org_id)

    if not user or not org or not membership:
        raise HTTPException(status_code=404, detail="کسب‌وکار یافت نشد")

    access = create_access_token(user.id, org.id, membership.role.value)
    refresh = create_refresh_token(db, user.id)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        user_id=user.id,
        org_id=org.id,
        role=membership.role.value,
    )
