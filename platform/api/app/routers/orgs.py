from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import MemberRole, Membership, User
from app.plans import list_plans_public, plan_exists, plan_limits
from app.schemas import (
    InviteIn,
    MemberOut,
    OnboardingAiSettingsIn,
    OnboardingKnowledgeIn,
    OnboardingPayIn,
    OnboardingPlanIn,
    OnboardingProfileIn,
    OrgOut,
    PlanUpdateIn,
)

router = APIRouter(prefix="/orgs", tags=["orgs"])


def _org_out(org) -> OrgOut:
    from app.services.payment_flow import subscription_days_left

    exp = getattr(org, "plan_expires_at", None)
    return OrgOut(
        id=org.id,
        name=org.name,
        plan=org.plan,
        limits=plan_limits(org.plan),
        onboarding_step=getattr(org, "onboarding_step", None) or "done",
        industry=getattr(org, "industry", "") or "",
        city=getattr(org, "city", "") or "",
        plan_expires_at=exp.isoformat() if exp else None,
        days_remaining=subscription_days_left(org),
        plan_label=str(plan_limits(org.plan).get("label") or org.plan),
    )


def _step(org) -> str:
    return getattr(org, "onboarding_step", None) or "done"


@router.get("/current", response_model=OrgOut)
def current_org(auth: AuthContext = Depends(get_auth)):
    return _org_out(auth.org)


@router.get("/plans")
def public_plans():
    return {"plans": list_plans_public()}


@router.get("/onboarding")
def get_onboarding(
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    from app.models import ExtensionSeat

    step = _step(auth.org)
    bootstrap_seat_token = None
    if step in ("guides", "ai_settings", "knowledge"):
        seat = (
            db.query(ExtensionSeat)
            .filter(
                ExtensionSeat.org_id == auth.org.id,
                ExtensionSeat.status != "revoked",
            )
            .order_by(ExtensionSeat.created_at.asc())
            .first()
        )
        if seat:
            bootstrap_seat_token = getattr(seat, "token_plain", None) or None
    return {
        "step": step,
        "needs_onboarding": step != "done",
        "org": _org_out(auth.org),
        "user": {
            "id": auth.user.id,
            "phone": auth.user.phone,
            "display_name": auth.user.display_name,
        },
        "role": auth.role.value,
        "plans": list_plans_public(),
        "bootstrap_seat_token": bootstrap_seat_token,
    }


@router.put("/onboarding/profile")
def onboarding_profile(
    body: OnboardingProfileIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    name = body.org_name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="نام کسب‌وکار لازم است")
    auth.org.name = name
    auth.org.industry = (body.industry or "").strip()
    auth.org.city = (body.city or "").strip()
    if body.display_name.strip():
        auth.user.display_name = body.display_name.strip()
    elif not auth.user.display_name:
        auth.user.display_name = name
    # Advance only from profile (or allow re-edit before done)
    if _step(auth.org) in ("profile", "plan", "payment", "ai_settings", "knowledge", "guides"):
        if _step(auth.org) == "profile":
            auth.org.onboarding_step = "plan"
    db.add(auth.org)
    db.add(auth.user)
    db.commit()
    db.refresh(auth.org)
    return {"ok": True, "step": _step(auth.org), "org": _org_out(auth.org)}


@router.put("/onboarding/plan")
def onboarding_plan(
    body: OnboardingPlanIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner)),
    db: Session = Depends(get_db),
):
    if not plan_exists(body.plan):
        raise HTTPException(status_code=400, detail="پلن نامعتبر است")
    auth.org.plan = body.plan
    if _step(auth.org) in ("plan", "profile"):
        auth.org.onboarding_step = "payment"
    elif _step(auth.org) == "payment":
        pass
    db.add(auth.org)
    db.commit()
    db.refresh(auth.org)
    return {
        "ok": True,
        "step": _step(auth.org),
        "org": _org_out(auth.org),
        "plan": plan_limits(body.plan),
    }


@router.post("/onboarding/pay")
def onboarding_pay(
    body: OnboardingPayIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner)),
    db: Session = Depends(get_db),
):
    """Pay for selected plan — mock instant, or Zibal redirect."""
    from app.models import Payment
    from app.services.payment_flow import (
        apply_paid_plan,
        mark_payment_paid,
        receipt_for,
    )
    from app.routers.payments import _provider, _start_zibal_payment

    plan = (body.plan or auth.org.plan or "starter").strip()
    if not plan_exists(plan):
        raise HTTPException(status_code=400, detail="پلن نامعتبر است")

    meta = plan_limits(plan)
    amount = int(meta.get("price_irr") or 0)
    provider = _provider()

    # Free plan or mock provider → instant complete
    if amount <= 0 or provider == "mock":
        digits = "".join(ch for ch in (body.mock_card or "") if ch.isdigit())
        if amount > 0 and digits.endswith("0000"):
            fail_pay = Payment(
                org_id=auth.org.id,
                user_id=auth.user.id,
                purpose="onboarding",
                plan=plan,
                amount_irr=amount,
                provider="mock",
                status="failed",
                raw_request=json.dumps(
                    {"provider": "mock", "mock_card": digits[-4:], "purpose": "onboarding"},
                    ensure_ascii=False,
                ),
                raw_verify=json.dumps({"ok": False, "error": "mock_card_0000"}, ensure_ascii=False),
            )
            db.add(fail_pay)
            db.commit()
            raise HTTPException(status_code=402, detail="پرداخت ناموفق (mock)")

        token = apply_paid_plan(
            db,
            auth.org,
            plan=plan,
            purpose="onboarding",
            user=auth.user,
            create_seat=True,
        )
        ref = "MOCK-" + auth.org.id[:8].upper()
        if amount > 0:
            payment = Payment(
                org_id=auth.org.id,
                user_id=auth.user.id,
                purpose="onboarding",
                plan=plan,
                amount_irr=amount,
                provider="mock",
                status="paid",
                ref_number=ref,
                raw_request=json.dumps(
                    {"provider": "mock", "purpose": "onboarding", "plan": plan, "amount_irr": amount},
                    ensure_ascii=False,
                ),
                raw_verify=json.dumps({"ok": True, "mock": True, "ref": ref}, ensure_ascii=False),
            )
            mark_payment_paid(payment, ref_number=ref)
            db.add(payment)
        db.commit()
        db.refresh(auth.org)
        return {
            "ok": True,
            "paid": True,
            "provider": "mock",
            "mock": True,
            "step": "ai_settings",
            "org": _org_out(auth.org),
            "bootstrap_seat_token": token,
            "receipt": receipt_for(plan, ref=ref, amount_irr=amount),
        }

    # Zibal: create pending payment + return redirect URL (no seat yet)
    auth.org.plan = plan
    db.add(auth.org)
    db.commit()
    started = _start_zibal_payment(
        db, org=auth.org, user=auth.user, plan=plan, purpose="onboarding"
    )
    return {
        "ok": True,
        "paid": False,
        "provider": "zibal",
        "mock": False,
        "step": _step(auth.org),
        "payment_url": started["payment_url"],
        "track_id": started["track_id"],
        "payment_id": started["payment_id"],
        "amount_irr": amount,
        "org": _org_out(auth.org),
    }


@router.put("/onboarding/ai-settings")
def onboarding_ai_settings(
    body: OnboardingAiSettingsIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    from app.models import AiPolicy

    role = (body.agent_role or "").strip()
    if len(role) < 3:
        raise HTTPException(status_code=400, detail="نقش دستیار را وارد کنید")

    policy = db.query(AiPolicy).filter(AiPolicy.org_id == auth.org.id).first()
    if not policy:
        policy = AiPolicy(org_id=auth.org.id)
    policy.agent_role = role
    policy.auto_send_enabled = bool(body.auto_send_enabled)
    if not policy.allowed_stages:
        policy.allowed_stages = ["جدید"]
    db.add(policy)

    if _step(auth.org) in ("ai_settings", "payment", "guides", "knowledge"):
        if _step(auth.org) in ("ai_settings", "payment"):
            auth.org.onboarding_step = "knowledge"
    db.add(auth.org)
    db.commit()
    db.refresh(auth.org)
    return {"ok": True, "step": _step(auth.org)}


@router.post("/onboarding/knowledge")
def onboarding_knowledge(
    body: OnboardingKnowledgeIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    from app.models import KnowledgeChunk, KnowledgeDoc
    from app.services.embeddings import chunk_text, embed_text
    from app.services.queue import enqueue

    title = (body.title or "").strip()
    content = (body.content or "").strip()
    if len(title) < 2:
        raise HTTPException(status_code=400, detail="عنوان دانش لازم است")
    if len(content) < 30:
        raise HTTPException(
            status_code=400,
            detail="متن دانش خیلی کوتاه است — حداقل یک پاراگراف FAQ یا قیمت وارد کنید",
        )

    doc = KnowledgeDoc(org_id=auth.org.id, title=title, source="onboarding")
    db.add(doc)
    db.flush()
    for part in chunk_text(content):
        db.add(
            KnowledgeChunk(
                org_id=auth.org.id,
                doc_id=doc.id,
                content=part,
                embedding=embed_text(part),
            )
        )

    if _step(auth.org) in ("knowledge", "ai_settings"):
        auth.org.onboarding_step = "guides"
    db.add(auth.org)
    db.commit()
    enqueue("embed", {"doc_id": doc.id, "org_id": auth.org.id})
    return {"ok": True, "step": _step(auth.org), "doc_id": doc.id}


@router.post("/onboarding/complete")
def onboarding_complete(
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    if _step(auth.org) not in ("guides", "done"):
        raise HTTPException(
            status_code=400,
            detail="ابتدا پروفایل، پلن، پرداخت، تنظیمات AI و دانش را تکمیل کنید",
        )
    auth.org.onboarding_step = "done"
    db.add(auth.org)
    db.commit()
    return {
        "ok": True,
        "step": "done",
        "org": _org_out(auth.org),
    }


@router.get("/members", response_model=list[MemberOut])
def list_members(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    rows = (
        db.query(Membership, User)
        .join(User, User.id == Membership.user_id)
        .filter(Membership.org_id == auth.org.id)
        .all()
    )
    return [
        MemberOut(
            id=m.id,
            user_id=u.id,
            phone=u.phone,
            display_name=u.display_name,
            role=m.role.value,
        )
        for m, u in rows
    ]


@router.post("/members", response_model=MemberOut)
def invite_member(
    body: InviteIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    limits = plan_limits(auth.org.plan)
    seat_count = db.query(Membership).filter(Membership.org_id == auth.org.id).count()
    if seat_count >= limits["max_seats"]:
        raise HTTPException(status_code=402, detail="سقف تعداد کاربران پلن پر شده است")

    phone = "".join(ch for ch in body.phone if ch.isdigit() or ch == "+")
    try:
        role = MemberRole(body.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="نقش نامعتبر است") from exc

    user = db.query(User).filter(User.phone == phone).first()
    if not user:
        user = User(phone=phone, display_name=body.display_name or phone)
        db.add(user)
        db.flush()

    existing = (
        db.query(Membership)
        .filter(Membership.org_id == auth.org.id, Membership.user_id == user.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="کاربر از قبل عضو است")

    membership = Membership(org_id=auth.org.id, user_id=user.id, role=role)
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return MemberOut(
        id=membership.id,
        user_id=user.id,
        phone=user.phone,
        display_name=user.display_name,
        role=membership.role.value,
    )


@router.patch("/plan", response_model=OrgOut)
def update_plan(
    body: PlanUpdateIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner)),
    db: Session = Depends(get_db),
):
    """Free starter switch only — paid plans go through /payments/start."""
    if not plan_exists(body.plan):
        raise HTTPException(status_code=400, detail="پلن نامعتبر است")
    price = int(plan_limits(body.plan).get("price_irr") or 0)
    if price > 0:
        raise HTTPException(
            status_code=400,
            detail="برای ارتقا یا تمدید پلن پولی از صفحه اشتراک (/billing) و پرداخت استفاده کنید",
        )
    from app.services.payment_flow import extend_subscription

    auth.org.plan = body.plan
    extend_subscription(auth.org, plan=body.plan)
    db.add(auth.org)
    db.commit()
    return _org_out(auth.org)
