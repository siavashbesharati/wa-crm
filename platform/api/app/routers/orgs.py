from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import MemberRole, Membership, User
from app.plans import PLANS, plan_limits
from app.schemas import InviteIn, MemberOut, OrgOut, PlanUpdateIn

router = APIRouter(prefix="/orgs", tags=["orgs"])


@router.get("/current", response_model=OrgOut)
def current_org(auth: AuthContext = Depends(get_auth)):
    return OrgOut(id=auth.org.id, name=auth.org.name, plan=auth.org.plan, limits=plan_limits(auth.org.plan))


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
    return OrgOut(id=auth.org.id, name=auth.org.name, plan=auth.org.plan, limits=plan_limits(auth.org.plan))
