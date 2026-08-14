"""Platform super-admin API — manage businesses, global AI defaults, system."""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import SuperAuthContext, get_super_auth
from app.plans import ensure_default_plans, list_plans_admin, plan_exists, plan_limits, row_to_meta
from app.schemas import LogoutIn, OtpRequestIn, OtpVerifyIn, TokenOut, TokenRefreshIn
from app.services.otp import consume_otp, issue_otp
from app.services.sms import normalize_mobile_for_sms_ir
from app.services.security import (
    create_access_token,
    create_platform_access_token,
    create_refresh_token,
    revoke_refresh_token,
    verify_refresh_token,
)
from app.models import (
    AiPolicy,
    ChannelAccount,
    Lead,
    MemberRole,
    Membership,
    Organization,
    Payment,
    PlatformSetting,
    PricingPlan,
    SmsTemplate,
    User,
)

router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()

AI_DEFAULTS_KEY = "ai_defaults"


def _normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit() or ch == "+")


def _phones_match(a: str, b: str) -> bool:
    try:
        return normalize_mobile_for_sms_ir(a) == normalize_mobile_for_sms_ir(b)
    except HTTPException:
        return _normalize_phone(a) == _normalize_phone(b)


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

    # Only this phone may be platform admin
    others = (
        db.query(User)
        .filter(User.is_platform_admin.is_(True), User.id != user.id)
        .all()
    )
    for other in others:
        other.is_platform_admin = False
        db.add(other)
    if others:
        db.commit()
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
    from app.services.ai_reply import get_platform_ai_settings

    return get_platform_ai_settings(db)


class SuperLoginIn(BaseModel):
    """Deprecated — use OTP endpoints. Kept for type compatibility only."""
    phone: str = ""
    password: str = ""


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
    provider: str = "openai_compatible"  # openai_compatible | gemini
    api_key: str = ""
    base_url: str = ""
    model: str = ""
    temperature: float = 0.4
    max_tokens: int = 2048
    top_p: float = 1.0
    reasoning_effort: str = ""  # "", low, medium, high (Groq / reasoning models)
    system_prompt: str = ""
    fallback_message: str = ""
    default_min_confidence: float = 0.55
    auto_send_default: bool = False
    notes: str = ""
    # legacy Gemini
    gemini_api_key: str = ""
    gemini_model: str = ""
    # legacy aliases
    openai_model: str = ""
    openai_base_url: str = ""


def _mask_key(key: str) -> str:
    key = (key or "").strip()
    if not key:
        return ""
    return key[:4] + "…" + key[-4:] if len(key) > 10 else "****"


def _ai_defaults_public(data: dict) -> dict:
    from app.services import openai_compat
    from app.services.ai_reply import llm_is_configured

    provider = (data.get("provider") or "openai_compatible").strip().lower()
    api_key = (data.get("api_key") or "").strip()
    gemini_key = (data.get("gemini_api_key") or "").strip()
    configured = llm_is_configured(data)
    active_key = gemini_key if provider == "gemini" else api_key
    return {
        **data,
        "api_key": "",
        "gemini_api_key": "",
        "api_key_masked": _mask_key(api_key),
        "api_key_configured": bool(api_key),
        "gemini_api_key_masked": _mask_key(gemini_key),
        "gemini_api_key_configured": bool(gemini_key),
        "llm_configured": configured,
        "active_key_masked": _mask_key(active_key),
        "presets": openai_compat.PROVIDER_PRESETS,
    }


@router.post("/otp/request")
def super_otp_request(body: OtpRequestIn, db: Session = Depends(get_db)):
    """OTP for platform owner only (phone must match SUPER_ADMIN_PHONE)."""
    phone = _normalize_phone(body.phone or settings.super_admin_phone)
    expected = _normalize_phone(settings.super_admin_phone)
    if not _phones_match(phone, expected):
        raise HTTPException(status_code=403, detail="این شماره مجاز به ورود سوپر ادمین نیست")
    # Store challenge against the canonical env phone so verify is consistent
    issue_phone = expected
    _ensure_platform_admin(db)
    issue_otp(db, issue_phone)
    return {"ok": True, "message": "کد تأیید پیامک شد"}


@router.post("/otp/verify", response_model=SuperTokenOut)
def super_otp_verify(body: OtpVerifyIn, db: Session = Depends(get_db)):
    phone = _normalize_phone(body.phone or settings.super_admin_phone)
    expected = _normalize_phone(settings.super_admin_phone)
    if not _phones_match(phone, expected):
        raise HTTPException(status_code=403, detail="این شماره مجاز به ورود سوپر ادمین نیست")
    consume_otp(db, expected, body.code)
    user = _ensure_platform_admin(db)
    access = create_platform_access_token(user.id)
    refresh = create_refresh_token(db, user.id)
    db.commit()
    return SuperTokenOut(
        access_token=access,
        refresh_token=refresh,
        user_id=user.id,
    )


@router.post("/login", response_model=SuperTokenOut, deprecated=True)
def super_login(body: SuperLoginIn, db: Session = Depends(get_db)):
    """Removed password login — use /admin/otp/request + /admin/otp/verify."""
    raise HTTPException(
        status_code=410,
        detail="ورود با رمز حذف شده است. از کد پیامکی (/admin/otp) استفاده کنید.",
    )


@router.post("/logout")
def super_logout(body: LogoutIn, db: Session = Depends(get_db)):
    revoke_refresh_token(db, body.refresh_token)
    db.commit()
    return {"ok": True}


@router.post("/refresh", response_model=SuperTokenOut)
def super_refresh(body: TokenRefreshIn, db: Session = Depends(get_db)):
    """Renew platform access token from a valid refresh token (survives API restarts)."""
    try:
        user = verify_refresh_token(db, body.refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    if not getattr(user, "is_platform_admin", False):
        raise HTTPException(status_code=403, detail="فقط سوپر ادمین")
    revoke_refresh_token(db, body.refresh_token)
    access = create_platform_access_token(user.id)
    refresh = create_refresh_token(db, user.id)
    db.commit()
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
    return _ai_defaults_public(data)


@router.put("/ai-defaults")
def put_ai_defaults(
    body: AiDefaultsIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    from app.services import gemini as gemini_svc
    from app.services import openai_compat
    from app.services.ai_reply import DEFAULT_FALLBACK_MESSAGE, DEFAULT_PLATFORM_SYSTEM, PROVIDERS

    current = _get_ai_defaults(db)
    provider = (body.provider or "openai_compatible").strip().lower()
    if provider not in PROVIDERS:
        provider = "openai_compatible"

    new_api_key = (body.api_key or "").strip()
    api_key = new_api_key if new_api_key else (current.get("api_key") or "")

    new_gemini_key = (body.gemini_api_key or "").strip()
    gemini_key = new_gemini_key if new_gemini_key else (current.get("gemini_api_key") or "")

    base_url = (body.base_url or body.openai_base_url or "").strip() or (
        current.get("base_url") or openai_compat.DEFAULT_BASE_URL
    )
    model = (body.model or body.openai_model or "").strip() or (
        current.get("model") or openai_compat.DEFAULT_MODEL
    )
    gemini_model = (body.gemini_model or "").strip() or (
        current.get("gemini_model") or gemini_svc.DEFAULT_MODEL
    )
    system_prompt = (body.system_prompt or "").strip() or DEFAULT_PLATFORM_SYSTEM
    fallback_message = (body.fallback_message or "").strip() or DEFAULT_FALLBACK_MESSAGE

    value = {
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url.rstrip("/"),
        "model": model,
        "temperature": float(body.temperature),
        "max_tokens": int(body.max_tokens or 2048),
        "top_p": float(body.top_p),
        "reasoning_effort": (body.reasoning_effort or "").strip(),
        "system_prompt": system_prompt,
        "fallback_message": fallback_message,
        "default_min_confidence": float(body.default_min_confidence),
        "auto_send_default": bool(body.auto_send_default),
        "notes": (body.notes or "").strip(),
        "gemini_api_key": gemini_key,
        "gemini_model": gemini_model,
        # keep legacy mirrors in sync
        "openai_model": model,
        "openai_base_url": base_url.rstrip("/"),
    }
    row = db.get(PlatformSetting, AI_DEFAULTS_KEY)
    if not row:
        row = PlatformSetting(key=AI_DEFAULTS_KEY, value=value)
        db.add(row)
    else:
        row.value = value
        row.updated_at = datetime.utcnow()
        db.add(row)
    db.commit()
    out = _get_ai_defaults(db)
    return {**_ai_defaults_public(out), "saved": True}


class AiPlaygroundIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    org_id: str = ""
    lead_id: str = ""
    lead_name: str = "مشتری تست"
    lead_stage: str = "جدید"
    system_prompt_override: str = ""
    agent_role_override: str = ""
    temperature: float = Field(default=0.4, ge=0.0, le=1.5)


@router.post("/ai-playground")
def ai_playground(
    body: AiPlaygroundIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    """Test platform Gemini config (optional: attach a business knowledge base)."""
    import time

    from app.services.ai_reply import playground_reply

    org_id = (body.org_id or "").strip() or None
    if org_id:
        org = db.get(Organization, org_id)
        if not org:
            raise HTTPException(status_code=404, detail="کسب‌وکار یافت نشد")

    started = time.perf_counter()
    try:
        result = playground_reply(
            db,
            message=body.message.strip(),
            org_id=org_id,
            lead_id=(body.lead_id or "").strip() or None,
            lead_name=(body.lead_name or "").strip() or "مشتری تست",
            lead_stage=(body.lead_stage or "").strip() or "جدید",
            system_prompt_override=(body.system_prompt_override or "").strip() or None,
            agent_role_override=(body.agent_role_override or "").strip() or None,
            temperature=float(body.temperature),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {
        "ok": True,
        "reply": result["reply"],
        "confidence": result["confidence"],
        "sources": result.get("sources") or [],
        "provider": result.get("provider"),
        "model": result.get("model"),
        "system_prompt_used": result.get("system_prompt_used") or "",
        "knowledge_hits": int(result.get("knowledge_hits") or 0),
        "history_messages": int(result.get("history_messages") or 0),
        "org_id": result.get("org_id") or "",
        "org_name": (db.get(Organization, org_id).name if org_id else ""),
        "elapsed_ms": elapsed_ms,
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


# ── SMS templates (sms.ir) ───────────────────────────────────────────


class SmsParamIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    source: str = Field(default="otp", pattern="^(otp|static)$")
    value: str = ""


class SmsTemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    template_id: int = Field(gt=0)
    parameters: list[SmsParamIn] = Field(default_factory=list)
    purpose: str = Field(default="otp", pattern="^(otp|custom)$")
    is_active: bool = True
    is_default: bool = False


class SmsTemplatePatchIn(BaseModel):
    name: str | None = None
    template_id: int | None = Field(default=None, gt=0)
    parameters: list[SmsParamIn] | None = None
    purpose: str | None = Field(default=None, pattern="^(otp|custom)$")
    is_active: bool | None = None
    is_default: bool | None = None


def _sms_template_out(row: SmsTemplate) -> dict:
    from app.services.sms import _normalize_parameters

    return {
        "id": row.id,
        "name": row.name,
        "template_id": int(row.template_id or 0),
        "parameters": _normalize_parameters(list(row.parameters or [])),
        "purpose": row.purpose or "otp",
        "is_active": bool(row.is_active),
        "is_default": bool(row.is_default),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _clear_other_defaults(db: Session, *, keep_id: str | None = None) -> None:
    q = db.query(SmsTemplate).filter(SmsTemplate.is_default.is_(True))
    if keep_id:
        q = q.filter(SmsTemplate.id != keep_id)
    for other in q.all():
        other.is_default = False
        db.add(other)


@router.get("/sms-templates")
def list_sms_templates(
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    rows = (
        db.query(SmsTemplate)
        .order_by(SmsTemplate.is_default.desc(), SmsTemplate.updated_at.desc())
        .all()
    )
    return {"templates": [_sms_template_out(r) for r in rows]}


@router.post("/sms-templates")
def create_sms_template(
    body: SmsTemplateIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    from app.services.sms import _normalize_parameters

    params = _normalize_parameters([p.model_dump() for p in body.parameters])
    if not params:
        params = [{"name": "Code", "source": "otp", "value": ""}]
    if body.is_default:
        _clear_other_defaults(db)
    row = SmsTemplate(
        name=body.name.strip(),
        template_id=int(body.template_id),
        parameters=params,
        purpose=body.purpose,
        is_active=bool(body.is_active),
        is_default=bool(body.is_default),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _sms_template_out(row)


@router.patch("/sms-templates/{template_row_id}")
def patch_sms_template(
    template_row_id: str,
    body: SmsTemplatePatchIn,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    from app.services.sms import _normalize_parameters

    row = db.get(SmsTemplate, template_row_id)
    if not row:
        raise HTTPException(status_code=404, detail="قالب یافت نشد")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = str(data["name"]).strip()
        if not name:
            raise HTTPException(status_code=400, detail="نام قالب خالی است")
        row.name = name
    if "template_id" in data and data["template_id"] is not None:
        row.template_id = int(data["template_id"])
    if "parameters" in data and data["parameters"] is not None:
        row.parameters = _normalize_parameters(list(data["parameters"]))
    if "purpose" in data and data["purpose"] is not None:
        row.purpose = data["purpose"]
    if "is_active" in data and data["is_active"] is not None:
        row.is_active = bool(data["is_active"])
    if "is_default" in data and data["is_default"] is not None:
        if data["is_default"]:
            _clear_other_defaults(db, keep_id=row.id)
        row.is_default = bool(data["is_default"])
    db.add(row)
    db.commit()
    db.refresh(row)
    return _sms_template_out(row)


@router.delete("/sms-templates/{template_row_id}")
def delete_sms_template(
    template_row_id: str,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    row = db.get(SmsTemplate, template_row_id)
    if not row:
        raise HTTPException(status_code=404, detail="قالب یافت نشد")
    db.delete(row)
    db.commit()
    return {"ok": True, "deleted": True}


# ── Platform dashboard / payments / support ───────────────────────────


def _payment_out(p: Payment, *, org_name: str = "", include_raw: bool = False) -> dict:
    out = {
        "id": p.id,
        "org_id": p.org_id,
        "org_name": org_name,
        "user_id": p.user_id,
        "purpose": p.purpose,
        "plan": p.plan,
        "amount_irr": int(p.amount_irr or 0),
        "provider": p.provider,
        "track_id": p.track_id or "",
        "ref_number": p.ref_number or "",
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
    }
    if include_raw:
        out["raw_request"] = p.raw_request or ""
        out["raw_callback"] = getattr(p, "raw_callback", "") or ""
        out["raw_verify"] = p.raw_verify or ""
    return out


@router.get("/dashboard")
def admin_dashboard(
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    from sqlalchemy import func

    from app.models import Message, Payment, SupportTicket

    week_ago = datetime.utcnow() - timedelta(days=7)
    orgs = db.query(Organization).count()
    active = db.query(Organization).filter(Organization.status == "active").count()
    suspended = db.query(Organization).filter(Organization.status == "suspended").count()
    users = db.query(User).count()
    leads = db.query(Lead).count()
    channels = db.query(ChannelAccount).count()

    pay_paid = (
        db.query(func.count(Payment.id)).filter(Payment.status == "paid").scalar() or 0
    )
    pay_failed = (
        db.query(func.count(Payment.id)).filter(Payment.status == "failed").scalar() or 0
    )
    pay_pending = (
        db.query(func.count(Payment.id)).filter(Payment.status == "pending").scalar() or 0
    )
    revenue = (
        db.query(func.coalesce(func.sum(Payment.amount_irr), 0))
        .filter(Payment.status == "paid")
        .scalar()
        or 0
    )
    revenue_7d = (
        db.query(func.coalesce(func.sum(Payment.amount_irr), 0))
        .filter(Payment.status == "paid", Payment.paid_at >= week_ago)
        .scalar()
        or 0
    )
    tickets_open = (
        db.query(func.count(SupportTicket.id))
        .filter(SupportTicket.status.in_(["open", "in_progress"]))
        .scalar()
        or 0
    )
    messages_7d = (
        db.query(func.count(Message.id)).filter(Message.created_at >= week_ago).scalar()
        or 0
    )

    recent_payments = (
        db.query(Payment, Organization)
        .join(Organization, Organization.id == Payment.org_id)
        .order_by(Payment.created_at.desc())
        .limit(12)
        .all()
    )
    recent_tickets = (
        db.query(SupportTicket, Organization)
        .join(Organization, Organization.id == SupportTicket.org_id)
        .order_by(SupportTicket.updated_at.desc())
        .limit(8)
        .all()
    )

    return {
        "ok": True,
        "metrics": {
            "businesses": orgs,
            "active_businesses": active,
            "suspended_businesses": suspended,
            "users": users,
            "leads": leads,
            "channel_accounts": channels,
            "payments_paid": int(pay_paid),
            "payments_failed": int(pay_failed),
            "payments_pending": int(pay_pending),
            "revenue_irr": int(revenue),
            "revenue_7d_irr": int(revenue_7d),
            "tickets_open": int(tickets_open),
            "messages_7d": int(messages_7d),
        },
        "recent_payments": [
            _payment_out(p, org_name=o.name) for p, o in recent_payments
        ],
        "recent_tickets": [
            {
                "id": t.id,
                "subject": t.subject,
                "status": t.status,
                "priority": t.priority,
                "category": t.category,
                "org_id": t.org_id,
                "org_name": o.name,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            }
            for t, o in recent_tickets
        ],
    }


@router.get("/payments")
def admin_list_payments(
    status: str | None = None,
    org_id: str | None = None,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    q = (
        db.query(Payment, Organization)
        .join(Organization, Organization.id == Payment.org_id)
        .order_by(Payment.created_at.desc())
    )
    if status:
        q = q.filter(Payment.status == status.strip())
    if org_id:
        q = q.filter(Payment.org_id == org_id.strip())
    rows = q.limit(300).all()
    return {"payments": [_payment_out(p, org_name=o.name) for p, o in rows]}


@router.get("/payments/{payment_id}")
def admin_get_payment(
    payment_id: str,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    row = (
        db.query(Payment, Organization)
        .join(Organization, Organization.id == Payment.org_id)
        .filter(Payment.id == payment_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="پرداخت یافت نشد")
    p, o = row
    return _payment_out(p, org_name=o.name, include_raw=True)


@router.get("/tickets")
def admin_list_tickets(
    status: str | None = None,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    from sqlalchemy import func

    from app.models import SupportMessage, SupportTicket

    q = (
        db.query(SupportTicket, Organization)
        .join(Organization, Organization.id == SupportTicket.org_id)
        .order_by(SupportTicket.updated_at.desc())
    )
    if status:
        q = q.filter(SupportTicket.status == status.strip())
    rows = q.limit(200).all()
    ids = [t.id for t, _ in rows]
    counts: dict[str, int] = {}
    if ids:
        counts = dict(
            db.query(SupportMessage.ticket_id, func.count(SupportMessage.id))
            .filter(SupportMessage.ticket_id.in_(ids))
            .group_by(SupportMessage.ticket_id)
            .all()
        )
    return {
        "tickets": [
            {
                "id": t.id,
                "subject": t.subject,
                "status": t.status,
                "priority": t.priority,
                "category": t.category,
                "org_id": t.org_id,
                "org_name": o.name,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
                "message_count": int(counts.get(t.id, 0)),
            }
            for t, o in rows
        ]
    }


@router.get("/tickets/{ticket_id}")
def admin_get_ticket(
    ticket_id: str,
    db: Session = Depends(get_db),
    _auth: SuperAuthContext = Depends(get_super_auth),
):
    from sqlalchemy.orm import joinedload

    from app.models import SupportMessage, SupportTicket

    ticket = (
        db.query(SupportTicket)
        .options(joinedload(SupportTicket.messages))
        .filter(SupportTicket.id == ticket_id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="تیکت یافت نشد")
    org = db.get(Organization, ticket.org_id)
    return {
        "id": ticket.id,
        "subject": ticket.subject,
        "status": ticket.status,
        "priority": ticket.priority,
        "category": ticket.category,
        "org_id": ticket.org_id,
        "org_name": org.name if org else "",
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
        "messages": [
            {
                "id": m.id,
                "sender_side": m.sender_side,
                "body": m.body,
                "user_name": (
                    (db.get(User, m.user_id).display_name or db.get(User, m.user_id).phone)
                    if m.user_id and db.get(User, m.user_id)
                    else "—"
                ),
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in (ticket.messages or [])
        ],
    }


class AdminTicketPatchIn(BaseModel):
    status: str | None = None
    priority: str | None = None


class AdminTicketMessageIn(BaseModel):
    body: str = Field(min_length=1)


@router.patch("/tickets/{ticket_id}")
def admin_patch_ticket(
    ticket_id: str,
    body: AdminTicketPatchIn,
    db: Session = Depends(get_db),
    auth: SuperAuthContext = Depends(get_super_auth),
):
    from app.models import SupportTicket

    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="تیکت یافت نشد")
    if body.status:
        if body.status not in ("open", "in_progress", "resolved", "closed"):
            raise HTTPException(status_code=400, detail="وضعیت نامعتبر")
        ticket.status = body.status
    if body.priority:
        if body.priority not in ("low", "normal", "high"):
            raise HTTPException(status_code=400, detail="اولویت نامعتبر")
        ticket.priority = body.priority
    ticket.updated_at = datetime.utcnow()
    db.add(ticket)
    db.commit()
    return {"ok": True, "id": ticket.id, "status": ticket.status, "priority": ticket.priority}


@router.post("/tickets/{ticket_id}/messages")
def admin_reply_ticket(
    ticket_id: str,
    body: AdminTicketMessageIn,
    db: Session = Depends(get_db),
    auth: SuperAuthContext = Depends(get_super_auth),
):
    from app.models import SupportMessage, SupportTicket

    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="تیکت یافت نشد")
    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            user_id=auth.user.id,
            sender_side="platform",
            body=body.body.strip(),
        )
    )
    if ticket.status == "open":
        ticket.status = "in_progress"
    ticket.updated_at = datetime.utcnow()
    db.add(ticket)
    db.commit()
    return {"ok": True}
