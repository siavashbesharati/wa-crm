from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import AuthContext, get_auth
from app.models import Membership, Organization, OtpChallenge, User
from app.plans import plan_limits
from app.schemas import OtpRequestIn, OtpVerifyIn, TokenOut
from app.services.security import create_access_token, create_refresh_token
from app.services.sms import send_otp

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit() or ch == "+")


@router.post("/otp/request")
def request_otp(body: OtpRequestIn, db: Session = Depends(get_db)):
    phone = _normalize_phone(body.phone)
    if len(phone) < 8:
        raise HTTPException(status_code=400, detail="شماره موبایل نامعتبر است")

    user = db.query(User).filter(User.phone == phone).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail="این شماره در سیستم ثبت نشده است. از پنل ادمین کسب‌وکار بسازید.",
        )

    code = settings.mock_otp_code
    challenge = OtpChallenge(
        phone=phone,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=5),
    )
    db.add(challenge)
    db.commit()
    send_otp(phone, code)
    return {
        "ok": True,
        "message": "کد تأیید آماده است",
        "dev_code": code if settings.app_env != "production" else None,
    }


@router.post("/otp/verify", response_model=TokenOut)
def verify_otp(body: OtpVerifyIn, db: Session = Depends(get_db)):
    phone = _normalize_phone(body.phone)
    user = db.query(User).filter(User.phone == phone).first()
    if not user:
        raise HTTPException(status_code=404, detail="این شماره در سیستم ثبت نشده است")

    challenge = (
        db.query(OtpChallenge)
        .filter(
            OtpChallenge.phone == phone,
            OtpChallenge.consumed.is_(False),
            OtpChallenge.expires_at >= datetime.utcnow(),
        )
        .order_by(OtpChallenge.created_at.desc())
        .first()
    )
    if not challenge or challenge.code != body.code.strip():
        raise HTTPException(status_code=400, detail="کد تأیید نادرست است")

    challenge.consumed = True
    membership = (
        db.query(Membership)
        .filter(Membership.user_id == user.id)
        .order_by(Membership.created_at.asc())
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="برای این شماره کسب‌وکاری تعریف نشده است")

    org = db.get(Organization, membership.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="سازمان یافت نشد")

    db.commit()
    access = create_access_token(user.id, org.id, membership.role.value)
    refresh = create_refresh_token(db, user.id)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        user_id=user.id,
        org_id=org.id,
        role=membership.role.value,
    )


@router.get("/me")
def me(auth: AuthContext = Depends(get_auth)):
    return {
        "user": {
            "id": auth.user.id,
            "phone": auth.user.phone,
            "display_name": auth.user.display_name,
        },
        "org": {
            "id": auth.org.id,
            "name": auth.org.name,
            "plan": auth.org.plan,
            "limits": plan_limits(auth.org.plan),
        },
        "role": auth.role.value,
    }
