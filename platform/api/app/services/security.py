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


def create_access_token(user_id: str, org_id: str, role: str) -> str:
    exp = datetime.utcnow() + timedelta(minutes=settings.jwt_access_minutes)
    return jwt.encode(
        {"sub": user_id, "org_id": org_id, "role": role, "exp": exp, "type": "access"},
        settings.jwt_secret,
        algorithm=ALGORITHM,
    )


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
