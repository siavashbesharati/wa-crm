"""Platform super-admin API — manage businesses, global AI defaults, system."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import SuperAuthContext, get_super_auth
from app.plans import ensure_default_plans, list_plans_admin, plan_exists, plan_limits, row_to_meta
from app.schemas import TokenOut
from app.services.security import (
    create_access_token,
    create_platform_access_token,
    create_refresh_token,
)
from app.models import (
    AiPolicy,
    ChannelAccount,
    Lead,
    MemberRole,
    Membership,
    Organization,
    PlatformSetting,
    PricingPlan,
    User,
)

router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()

AI_DEFAULTS_KEY = "ai_defaults"


def _normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit() or ch == "+")


def _ensure_platform_admin(db: Session) -> User:
    phone = _normalize_phone(settings.super_admin_phone)
    user = db.query(User).filter(User.phone == phone).first()
    if not user:
        user = User(
            phone=phone,
            display_name="سوپر ادمین",
            is_platform_admin=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.is_platform_admin:
        user.is_platform_admin = True
        db.commit()
        db.refresh(user)
    return user


def _owner_for_org(db: Session, org_id: str) -> User | None:
    membership = (
        db.query(Membership)
        .filter(Membership.org_id == org_id, Membership.role == MemberRole.owner)
        .first()
    )
    if not membership:
        return None
    return db.get(User, membership.user_id)


def _business_out(db: Session, org: Organization) -> "BusinessOut":
    owner = _owner_for_org(db, org.id)
    return BusinessOut(
        org_id=org.id,
        name=org.name,
        plan=org.plan,
        status=getattr(org, "status", None) or "active",
        owner_phone=owner.phone if owner else "",
        owner_name=(owner.display_name if owner else "") or (owner.phone if owner else ""),
        limits=plan_limits(org.plan),
        created_at=org.created_at,
    )


def _get_ai_defaults(db: Session) -> dict:
    row = db.get(PlatformSetting, AI_DEFAULTS_KEY)
    base = {
        "openai_model": settings.openai_model,
        "openai_base_url": settings.openai_base_url,
        "default_min_confidence": 0.55,
        "auto_send_default": False,
        "notes": "",
    }
    if row and isinstance(row.value, dict):
        base.update(row.value)
    return base


class SuperLoginIn(BaseModel):
    phone: str = ""
    password: str = Field(min_length=1)


class SuperTokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    role: str = "super_admin"
    scope: str = "platform"


class BusinessIn(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(min_length=8)
    plan: str = "growth"
    display_name: str = ""


class BusinessPatchIn(BaseModel):
    name: str | None = None
    plan: str | None = None
    status: str | None = None  # active | suspended
    owner_phone: str | None = None


class BusinessOut(BaseModel):
    org_id: str
    name: str
    plan: str
    status: str = "active"
    owner_phone: str
    owner_name: str
    limits: dict
    created_at: datetime | None = None


class EnterIn(BaseModel):
    org_id: str = ""
    phone: str = ""


class AiDefaultsIn(BaseModel):
    openai_model: str = ""
    openai_base_url: str = ""
    default_min_confidence: float = 0.55
    auto_send_default: bool = False
    notes: str = ""


@router.post("/login", response_model=SuperTokenOut)
def super_login(body: SuperLoginIn, db: Session = Depends(get_db)):
    phone = _normalize_phone(body.phone or settings.super_admin_phone)
    expected_phone = _normalize_phone(settings.super_admin_phone)
    if phone != expected_phone or body.password != settings.super_admin_password:
        raise HTTPException(status_code=401, detail="شماره یا رمز سوپر ادمین نادرست است")

    user = _ensure_platform_admin(db)
    access = create_platform_access_token(user.id)
    refresh = create_refresh_token(db, user.id)
    return SuperTokenOut(
        access_token=access,
        refresh_token=refresh,
        user_id=user.id,
    )


@router.get("/me")
def super_me(auth: SuperAuthContext = Depends(get_super_auth)):
    return {
        "user": {
            "id": auth.user.id,
            "phone": auth.user.phone,
            "display_name": auth.user.display_name or "سوپر ادمین",
        },
        "role": "super_admin",
        "scope": "platform",
        "env": settings.app_env,
    }


@router.get("/businesses", response_model=list[BusinessOut])
def list_businesses(
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    orgs = db.query(Organization).order_by(Organization.created_at.desc()).all()
    return [_business_out(db, org) for org in orgs]


@router.post("/businesses", response_model=BusinessOut)
def create_business(
    body: BusinessIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    phone = _normalize_phone(body.phone)
    if len(phone) < 8:
        raise HTTPException(status_code=400, detail="شماره موبایل نامعتبر است")
    plan = body.plan if plan_exists(body.plan) else "growth"
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="نام کسب‌وکار لازم است")

    existing = db.query(User).filter(User.phone == phone).first()
    if existing:
        raise HTTPException(status_code=400, detail="این شماره از قبل ثبت شده است")

    defaults = _get_ai_defaults(db)
    user = User(phone=phone, display_name=(body.display_name or name).strip() or phone)
    org = Organization(name=name, plan=plan, status="active", onboarding_step="done")
    db.add(user)
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=user.id, role=MemberRole.owner))
    db.add(
        AiPolicy(
            org_id=org.id,
            auto_send_enabled=bool(defaults.get("auto_send_default")),
            min_confidence=float(defaults.get("default_min_confidence") or 0.55),
        )
    )
    # Channels are created by the extension via seat token, not pre-seeded.
    db.commit()
    db.refresh(org)
    return _business_out(db, org)


@router.patch("/businesses/{org_id}", response_model=BusinessOut)
def patch_business(
    org_id: str,
    body: BusinessPatchIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="کسب‌وکار یافت نشد")

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="نام نامعتبر است")
        org.name = name
    if body.plan is not None:
        if not plan_exists(body.plan):
            raise HTTPException(status_code=400, detail="پلن نامعتبر است")
        org.plan = body.plan
    if body.status is not None:
        if body.status not in ("active", "suspended"):
            raise HTTPException(status_code=400, detail="وضعیت نامعتبر است")
        org.status = body.status

    if body.owner_phone is not None:
        phone = _normalize_phone(body.owner_phone)
        if len(phone) < 8:
            raise HTTPException(status_code=400, detail="شماره موبایل نامعتبر است")
        owner = _owner_for_org(db, org.id)
        clash = db.query(User).filter(User.phone == phone).first()
        if clash and (not owner or clash.id != owner.id):
            raise HTTPException(status_code=400, detail="این شماره متعلق به کاربر دیگری است")
        if owner:
            owner.phone = phone

    db.commit()
    db.refresh(org)
    return _business_out(db, org)


@router.post("/enter", response_model=TokenOut)
def enter_business(
    body: EnterIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    """Impersonate business owner — for platform support only."""
    org = None
    user = None
    membership = None
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

    access = create_access_token(user.id, org.id, membership.role.value, scope="org")
    refresh = create_refresh_token(db, user.id)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        user_id=user.id,
        org_id=org.id,
        role=membership.role.value,
    )


@router.get("/ai-defaults")
def get_ai_defaults(
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    data = _get_ai_defaults(db)
    return {
        **data,
        "openai_api_key_configured": bool(settings.openai_api_key),
        "env_openai_model": settings.openai_model,
        "env_openai_base_url": settings.openai_base_url,
    }


@router.put("/ai-defaults")
def put_ai_defaults(
    body: AiDefaultsIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    value = {
        "openai_model": (body.openai_model or settings.openai_model).strip(),
        "openai_base_url": (body.openai_base_url or settings.openai_base_url).strip(),
        "default_min_confidence": float(body.default_min_confidence),
        "auto_send_default": bool(body.auto_send_default),
        "notes": (body.notes or "").strip(),
    }
    row = db.get(PlatformSetting, AI_DEFAULTS_KEY)
    if not row:
        row = PlatformSetting(key=AI_DEFAULTS_KEY, value=value)
        db.add(row)
    else:
        row.value = value
        row.updated_at = datetime.utcnow()
    db.commit()
    return {
        **value,
        "openai_api_key_configured": bool(settings.openai_api_key),
        "saved": True,
    }


@router.get("/system")
def system_status(
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    orgs = db.query(Organization).count()
    active = (
        db.query(Organization)
        .filter(Organization.status == "active")
        .count()
        if hasattr(Organization, "status")
        else orgs
    )
    users = db.query(User).count()
    leads = db.query(Lead).count()
    channels = db.query(ChannelAccount).count()
    online = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.status.in_(["connected", "online", "ready"]))
        .count()
    )
    return {
        "ok": True,
        "env": settings.app_env,
        "counts": {
            "businesses": orgs,
            "active_businesses": active,
            "users": users,
            "leads": leads,
            "channel_accounts": channels,
            "channels_online": online,
        },
        "openai_api_key_configured": bool(settings.openai_api_key),
        "openai_model": settings.openai_model,
    }


# ── Pricing plans CRUD ──────────────────────────────────────────────


class PlanIn(BaseModel):
    id: str = Field(min_length=2, max_length=40)
    label: str = Field(min_length=1, max_length=120)
    price_irr: int = 0
    price_label: str = ""
    max_seats: int = Field(default=1, ge=1)
    max_channel_accounts: int = Field(default=9999, ge=1)
    ai_suggest: bool = True
    ai_auto_send: bool = False
    message_retention_days: int = Field(default=30, ge=1)
    features: list[str] = Field(default_factory=list)
    sort_order: int = 0
    is_active: bool = True


class PlanPatchIn(BaseModel):
    label: str | None = None
    price_irr: int | None = None
    price_label: str | None = None
    max_seats: int | None = Field(default=None, ge=1)
    max_channel_accounts: int | None = Field(default=None, ge=1)
    ai_suggest: bool | None = None
    ai_auto_send: bool | None = None
    message_retention_days: int | None = Field(default=None, ge=1)
    features: list[str] | None = None
    sort_order: int | None = None
    is_active: bool | None = None


def _slugify_plan_id(raw: str) -> str:
    s = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in raw.strip().lower())
    s = "-".join(p for p in s.replace("_", "-").split("-") if p)
    return s[:40]


@router.get("/plans")
def admin_list_plans(
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    ensure_default_plans(db)
    return {"plans": list_plans_admin(db=db)}


@router.post("/plans")
def admin_create_plan(
    body: PlanIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    ensure_default_plans(db)
    pid = _slugify_plan_id(body.id)
    if len(pid) < 2:
        raise HTTPException(status_code=400, detail="شناسه پلن نامعتبر است")
    if db.get(PricingPlan, pid):
        raise HTTPException(status_code=400, detail="این شناسه پلن از قبل وجود دارد")
    features = [str(x).strip() for x in (body.features or []) if str(x).strip()]
    price_label = body.price_label.strip()
    if not price_label:
        price_label = "رایگان" if body.price_irr <= 0 else f"{body.price_irr:,} ریال / ماه"
    row = PricingPlan(
        id=pid,
        label=body.label.strip(),
        price_irr=int(body.price_irr),
        price_label=price_label,
        max_seats=int(body.max_seats),
        max_channel_accounts=int(body.max_channel_accounts),
        ai_suggest=bool(body.ai_suggest),
        ai_auto_send=bool(body.ai_auto_send),
        message_retention_days=int(body.message_retention_days),
        features=features,
        sort_order=int(body.sort_order),
        is_active=bool(body.is_active),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row_to_meta(row)


@router.patch("/plans/{plan_id}")
def admin_patch_plan(
    plan_id: str,
    body: PlanPatchIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    row = db.get(PricingPlan, plan_id)
    if not row:
        raise HTTPException(status_code=404, detail="پلن یافت نشد")
    data = body.model_dump(exclude_unset=True)
    if "label" in data and data["label"] is not None:
        label = str(data["label"]).strip()
        if not label:
            raise HTTPException(status_code=400, detail="نام پلن خالی است")
        row.label = label
    if "price_irr" in data and data["price_irr"] is not None:
        row.price_irr = int(data["price_irr"])
    if "price_label" in data and data["price_label"] is not None:
        row.price_label = str(data["price_label"]).strip()
    if "max_seats" in data and data["max_seats"] is not None:
        row.max_seats = int(data["max_seats"])
    if "max_channel_accounts" in data and data["max_channel_accounts"] is not None:
        row.max_channel_accounts = int(data["max_channel_accounts"])
    if "ai_suggest" in data and data["ai_suggest"] is not None:
        row.ai_suggest = bool(data["ai_suggest"])
    if "ai_auto_send" in data and data["ai_auto_send"] is not None:
        row.ai_auto_send = bool(data["ai_auto_send"])
    if "message_retention_days" in data and data["message_retention_days"] is not None:
        row.message_retention_days = int(data["message_retention_days"])
    if "features" in data and data["features"] is not None:
        row.features = [str(x).strip() for x in data["features"] if str(x).strip()]
    if "sort_order" in data and data["sort_order"] is not None:
        row.sort_order = int(data["sort_order"])
    if "is_active" in data and data["is_active"] is not None:
        row.is_active = bool(data["is_active"])
    db.add(row)
    db.commit()
    db.refresh(row)
    return row_to_meta(row)


@router.delete("/plans/{plan_id}")
def admin_delete_plan(
    plan_id: str,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    row = db.get(PricingPlan, plan_id)
    if not row:
        raise HTTPException(status_code=404, detail="پلن یافت نشد")
    in_use = db.query(Organization).filter(Organization.plan == plan_id).count()
    if in_use > 0:
        # Soft-delete so existing orgs keep resolving limits
        row.is_active = False
        db.add(row)
        db.commit()
        return {
            "ok": True,
            "deleted": False,
            "deactivated": True,
            "in_use": in_use,
            "message": f"پلن توسط {in_use} کسب‌وکار استفاده می‌شود — غیرفعال شد",
        }
    db.delete(row)
    db.commit()
    return {"ok": True, "deleted": True, "deactivated": False, "in_use": 0}
