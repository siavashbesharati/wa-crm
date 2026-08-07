from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import AuthContext, get_auth
from app.models import (
    AiPolicy,
    MemberRole,
    Membership,
    Organization,
    OtpChallenge,
    PlatformSetting,
    User,
)
from app.plans import plan_limits
from app.schemas import OtpRequestIn, OtpVerifyIn, TokenOut
from app.services.security import create_access_token, create_refresh_token
from app.services.sms import send_otp

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

AI_DEFAULTS_KEY = "ai_defaults"


def _normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit() or ch == "+")


def _issue_otp(db: Session, phone: str) -> str:
    code = settings.mock_otp_code
    challenge = OtpChallenge(
        phone=phone,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=5),
    )
    db.add(challenge)
    db.commit()
    send_otp(phone, code)
    return code


def _consume_otp(db: Session, phone: str, code: str) -> None:
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
    if not challenge or challenge.code != code.strip():
        raise HTTPException(status_code=400, detail="کد تأیید نادرست است")
    challenge.consumed = True


def _ai_defaults(db: Session) -> dict:
    row = db.get(PlatformSetting, AI_DEFAULTS_KEY)
    base = {"auto_send_default": False, "default_min_confidence": 0.55}
    if row and isinstance(row.value, dict):
        base.update(row.value)
    return base


def _org_step(org: Organization) -> str:
    return getattr(org, "onboarding_step", None) or "done"


def _create_draft_business(db: Session, phone: str) -> tuple[User, Organization, Membership]:
    """Phone-only signup: draft org; profile completed in wizard."""
    defaults = _ai_defaults(db)
    user = User(phone=phone, display_name="")
    org = Organization(
        name="کسب‌وکار جدید",
        plan="starter",
        status="active",
        onboarding_step="profile",
    )
    db.add(user)
    db.add(org)
    db.flush()
    membership = Membership(org_id=org.id, user_id=user.id, role=MemberRole.owner)
    db.add(membership)
    db.add(
        AiPolicy(
            org_id=org.id,
            auto_send_enabled=bool(defaults.get("auto_send_default")),
            min_confidence=float(defaults.get("default_min_confidence") or 0.55),
        )
    )
    # Channel accounts are created when the extension connects with a seat token
    # (ensureChannelAccount) — not pre-seeded, so orgs start empty.
    return user, org, membership


def _token_out(
    db: Session,
    user: User,
    org: Organization,
    membership: Membership,
    *,
    is_new: bool = False,
) -> TokenOut:
    access = create_access_token(user.id, org.id, membership.role.value, scope="org")
    refresh = create_refresh_token(db, user.id)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        user_id=user.id,
        org_id=org.id,
        role=membership.role.value,
        is_new=is_new,
        onboarding_step=_org_step(org),
    )


@router.post("/otp/request")
def request_otp(body: OtpRequestIn, db: Session = Depends(get_db)):
    """Unified phone OTP — works for both existing and new numbers."""
    phone = _normalize_phone(body.phone)
    if len(phone) < 8:
        raise HTTPException(status_code=400, detail="شماره موبایل نامعتبر است")

    existing = db.query(User).filter(User.phone == phone).first()
    code = _issue_otp(db, phone)
    return {
        "ok": True,
        "exists": bool(existing),
        "message": "کد تأیید آماده است",
        "dev_code": code if settings.app_env != "production" else None,
    }


@router.post("/otp/verify", response_model=TokenOut)
def verify_otp(body: OtpVerifyIn, db: Session = Depends(get_db)):
    """If phone exists → login. If not → create draft business + start wizard."""
    phone = _normalize_phone(body.phone)
    if len(phone) < 8:
        raise HTTPException(status_code=400, detail="شماره موبایل نامعتبر است")

    _consume_otp(db, phone, body.code)

    user = db.query(User).filter(User.phone == phone).first()
    is_new = False

    if user:
        membership = (
            db.query(Membership)
            .filter(Membership.user_id == user.id)
            .order_by(Membership.created_at.asc())
            .first()
        )
        if not membership:
            # Orphan user (e.g. platform admin phone) — not allowed as business
            if getattr(user, "is_platform_admin", False):
                raise HTTPException(
                    status_code=400,
                    detail="این شماره برای سوپر ادمین است. از /super وارد شوید.",
                )
            raise HTTPException(status_code=404, detail="برای این شماره کسب‌وکاری تعریف نشده است")
        org = db.get(Organization, membership.org_id)
        if not org:
            raise HTTPException(status_code=404, detail="سازمان یافت نشد")
        if getattr(org, "status", "active") == "suspended":
            raise HTTPException(status_code=403, detail="این کسب‌وکار موقتاً غیرفعال است")
        db.commit()
        return _token_out(db, user, org, membership, is_new=False)

    user, org, membership = _create_draft_business(db, phone)
    is_new = True
    db.commit()
    return _token_out(db, user, org, membership, is_new=is_new)


@router.get("/me")
def me(auth: AuthContext = Depends(get_auth)):
    from app.services.payment_flow import subscription_days_left

    exp = getattr(auth.org, "plan_expires_at", None)
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
            "plan_label": plan_limits(auth.org.plan).get("label") or auth.org.plan,
            "limits": plan_limits(auth.org.plan),
            "onboarding_step": _org_step(auth.org),
            "industry": getattr(auth.org, "industry", "") or "",
            "city": getattr(auth.org, "city", "") or "",
            "status": getattr(auth.org, "status", "active") or "active",
            "plan_expires_at": exp.isoformat() if exp else None,
            "days_remaining": subscription_days_left(auth.org),
        },
        "role": auth.role.value,
        "onboarding_step": _org_step(auth.org),
        # Only owners must finish wizard; invited operators can use the CRM
        "needs_onboarding": _org_step(auth.org) != "done"
        and auth.role == MemberRole.owner,
    }
