from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Membership, RefreshToken, User

settings = get_settings()
ALGORITHM = "HS256"


def create_access_token(
    user_id: str,
    org_id: str,
    role: str,
    *,
    scope: str = "org",
    seat_id: str = "",
    install_id: str = "",
    access_minutes: int | None = None,
) -> str:
    mins = access_minutes if access_minutes is not None else settings.jwt_access_minutes
    exp = datetime.utcnow() + timedelta(minutes=mins)
    payload = {
        "sub": user_id,
        "org_id": org_id or "",
        "role": role,
        "scope": scope,
        "exp": exp,
        "type": "access",
    }
    if seat_id:
        payload["seat_id"] = seat_id
    if install_id:
        payload["install_id"] = install_id
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def create_platform_access_token(user_id: str) -> str:
    return create_access_token(user_id, "", "super_admin", scope="platform")


def create_refresh_token(db: Session, user_id: str) -> str:
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=datetime.utcnow() + timedelta(days=settings.jwt_refresh_days),
        )
    )
    db.commit()
    return raw


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("توکن نامعتبر است") from exc
    if payload.get("type") != "access":
        raise ValueError("توکن نامعتبر است")
    return payload


def get_membership(db: Session, user_id: str, org_id: str) -> Membership | None:
    return (
        db.query(Membership)
        .filter(Membership.user_id == user_id, Membership.org_id == org_id)
        .first()
    )


def get_user(db: Session, user_id: str) -> User | None:
    return db.get(User, user_id)


def verify_refresh_token(db: Session, raw: str) -> User:
    """Validate a refresh token and return its user."""
    token = (raw or "").strip()
    if len(token) < 16:
        raise ValueError("نشست منقضی شده — دوباره وارد شوید")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked.is_(False),
            RefreshToken.expires_at > datetime.utcnow(),
        )
        .first()
    )
    if not row:
        raise ValueError("نشست منقضی شده — دوباره وارد شوید")
    user = db.get(User, row.user_id)
    if not user:
        raise ValueError("کاربر یافت نشد")
    return user


def revoke_refresh_token(db: Session, raw: str) -> None:
    token = (raw or "").strip()
    if len(token) < 16:
        return
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    if row:
        row.revoked = True
        db.add(row)
