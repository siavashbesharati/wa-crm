from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import MemberRole, Membership, Organization, User
from app.plans import plan_limits
from app.services.security import decode_access_token, get_membership, get_user


@dataclass
class AuthContext:
    user: User
    org: Organization
    membership: Membership

    @property
    def role(self) -> MemberRole:
        return self.membership.role

    @property
    def limits(self) -> dict:
        return plan_limits(self.org.plan)


def get_auth(
    authorization: str | None = Header(default=None),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
    db: Session = Depends(get_db),
) -> AuthContext:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="احراز هویت لازم است")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = get_user(db, payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="کاربر یافت نشد")

    org_id = x_org_id or payload.get("org_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="سازمان مشخص نیست")

    membership = get_membership(db, user.id, org_id)
    if not membership:
        raise HTTPException(status_code=403, detail="دسترسی به این سازمان ندارید")

    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="سازمان یافت نشد")

    return AuthContext(user=user, org=org, membership=membership)


def require_roles(*roles: MemberRole):
    allowed = set(roles) | {MemberRole.owner}

    def _inner(auth: AuthContext = Depends(get_auth)) -> AuthContext:
        if auth.role not in allowed:
            raise HTTPException(status_code=403, detail="دسترسی کافی نیست")
        return auth

    return _inner
