"""OTP challenge helpers (shared by business + super-admin)."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import OtpChallenge
from app.services.sms import send_otp


def generate_otp_code(length: int = 6) -> str:
    return f"{secrets.randbelow(10**length):0{length}d}"


def issue_otp(db: Session, phone: str, *, ttl_minutes: int = 5) -> None:
    """Create challenge and send SMS. Does not return the code to the client."""
    recent = (
        db.query(OtpChallenge)
        .filter(
            OtpChallenge.phone == phone,
            OtpChallenge.created_at >= datetime.utcnow() - timedelta(seconds=55),
        )
        .order_by(OtpChallenge.created_at.desc())
        .first()
    )
    if recent and not recent.consumed:
        raise HTTPException(
            status_code=429,
            detail="کد قبلی هنوز معتبر است — کمی صبر کنید و دوباره تلاش کنید",
        )

    code = generate_otp_code(6)
    challenge = OtpChallenge(
        phone=phone,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=ttl_minutes),
    )
    db.add(challenge)
    db.commit()
    try:
        send_otp(phone, code, db=db)
    except Exception:
        # Allow retry with a new code
        challenge.consumed = True
        db.add(challenge)
        db.commit()
        raise


def consume_otp(db: Session, phone: str, code: str) -> None:
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
    db.add(challenge)
