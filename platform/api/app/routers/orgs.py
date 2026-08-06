from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import MemberRole, Membership, User
from app.plans import PLANS, list_plans_public, plan_limits
from app.schemas import (
    InviteIn,
    MemberOut,
    OnboardingPayIn,
    OnboardingPlanIn,
    OnboardingProfileIn,
    OrgOut,
    PlanUpdateIn,
)

router = APIRouter(prefix="/orgs", tags=["orgs"])


def _org_out(org) -> OrgOut:
    return OrgOut(
        id=org.id,
        name=org.name,
        plan=org.plan,
        limits=plan_limits(org.plan),
        onboarding_step=getattr(org, "onboarding_step", None) or "done",
        industry=getattr(org, "industry", "") or "",
        city=getattr(org, "city", "") or "",
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
    if step == "guides":
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
    if _step(auth.org) in ("profile", "plan", "payment", "guides"):
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
    if body.plan not in PLANS:
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
    """Mock payment → create first extension seat → advance to guides."""
    from app.models import ExtensionSeat
    from app.services.seat_tokens import hash_token, new_raw_token

    plan = (body.plan or auth.org.plan or "starter").strip()
    if plan not in PLANS:
        raise HTTPException(status_code=400, detail="پلن نامعتبر است")
    digits = "".join(ch for ch in (body.mock_card or "") if ch.isdigit())
    if digits.endswith("0000"):
        raise HTTPException(status_code=402, detail="پرداخت ناموفق (mock)")

    auth.org.plan = plan
    auth.org.onboarding_step = "guides"
    db.add(auth.org)

    bootstrap_token = None
    existing_seats = (
        db.query(ExtensionSeat)
        .filter(ExtensionSeat.org_id == auth.org.id, ExtensionSeat.status != "revoked")
        .count()
    )
    if existing_seats == 0:
        raw = new_raw_token()
        db.add(
            ExtensionSeat(
                org_id=auth.org.id,
                label="صندلی مالک",
                token_prefix=raw[:12],
                token_hash=hash_token(raw),
                token_plain=raw,
                status="available",
                created_by_user_id=auth.user.id,
            )
        )
        bootstrap_token = raw
    else:
        existing = (
            db.query(ExtensionSeat)
            .filter(ExtensionSeat.org_id == auth.org.id, ExtensionSeat.status != "revoked")
            .order_by(ExtensionSeat.created_at.asc())
            .first()
        )
        if existing:
            bootstrap_token = getattr(existing, "token_plain", None) or None

    db.commit()
    db.refresh(auth.org)
    meta = plan_limits(plan)
    return {
        "ok": True,
        "paid": True,
        "mock": True,
        "step": "guides",
        "org": _org_out(auth.org),
        "bootstrap_seat_token": bootstrap_token,
        "receipt": {
            "plan": plan,
            "amount_irr": meta.get("price_irr", 0),
            "label": meta.get("price_label", ""),
            "ref": "MOCK-" + auth.org.id[:8].upper(),
        },
    }


@router.post("/onboarding/complete")
def onboarding_complete(
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    if _step(auth.org) not in ("guides", "done"):
        raise HTTPException(
            status_code=400,
            detail="ابتدا پروفایل، پلن و پرداخت را تکمیل کنید",
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
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="پلن نامعتبر است")
    auth.org.plan = body.plan
    db.add(auth.org)
    db.commit()
    return _org_out(auth.org)
