from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ExtensionSeat, MemberRole, Membership, Organization, User
from app.plans import plan_limits
from app.services.security import decode_access_token, get_membership, get_user


@dataclass
class AuthContext:
    user: User
    org: Organization
    membership: Membership
    seat: ExtensionSeat | None = None

    @property
    def role(self) -> MemberRole:
        return self.membership.role

    @property
    def limits(self) -> dict:
        return plan_limits(self.org.plan)


@dataclass
class SuperAuthContext:
    user: User


def _bearer_payload(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="احراز هویت لازم است")
    token = authorization.split(" ", 1)[1].strip()
    try:
        return decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def get_auth(
    authorization: str | None = Header(default=None),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
    db: Session = Depends(get_db),
) -> AuthContext:
    payload = _bearer_payload(authorization)
    if payload.get("scope") == "platform":
        raise HTTPException(status_code=403, detail="این توکن برای پنل کسب‌وکار نیست")

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
    if getattr(org, "status", "active") == "suspended":
        raise HTTPException(status_code=403, detail="این کسب‌وکار موقتاً غیرفعال است")

    seat = None
    seat_id = payload.get("seat_id") or ""
    if seat_id:
        seat = db.get(ExtensionSeat, seat_id)
        if not seat or seat.org_id != org.id:
            raise HTTPException(status_code=403, detail="توکن افزونه نامعتبر است")
        if seat.status == "revoked":
            raise HTTPException(status_code=403, detail="این توکن توسط مدیر لغو شده است")
        install_id = str(payload.get("install_id") or "")
        if seat.status == "locked" and seat.bound_install_id and install_id:
            if seat.bound_install_id != install_id:
                raise HTTPException(
                    status_code=403,
                    detail="این توکن روی نصب دیگری قفل شده است",
                )

    return AuthContext(user=user, org=org, membership=membership, seat=seat)


def get_super_auth(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SuperAuthContext:
    payload = _bearer_payload(authorization)
    if payload.get("scope") != "platform" or payload.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="فقط سوپر ادمین")

    user = get_user(db, payload["sub"])
    if not user or not getattr(user, "is_platform_admin", False):
        raise HTTPException(status_code=403, detail="فقط سوپر ادمین")

    return SuperAuthContext(user=user)


def require_roles(*roles: MemberRole):
    allowed = set(roles) | {MemberRole.owner}

    def _inner(auth: AuthContext = Depends(get_auth)) -> AuthContext:
        if auth.role not in allowed:
            raise HTTPException(status_code=403, detail="دسترسی کافی نیست")
        return auth

    return _inner
