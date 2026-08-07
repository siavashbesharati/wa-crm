"""Shared payment completion helpers (mock + Zibal callback)."""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import ExtensionSeat, Organization, Payment, User
from app.plans import plan_limits
from app.services.seat_tokens import hash_token, new_raw_token

SUBSCRIPTION_DAYS = 30


def subscription_days_left(org: Organization) -> int | None:
    """Remaining whole days until plan_expires_at; None if no expiry (e.g. starter)."""
    exp = getattr(org, "plan_expires_at", None)
    if not exp:
        return None
    seconds = (exp - datetime.utcnow()).total_seconds()
    if seconds <= 0:
        return 0
    return max(1, math.ceil(seconds / 86400))


def extend_subscription(org: Organization, *, plan: str, days: int = SUBSCRIPTION_DAYS) -> None:
    """Set/extend plan_expires_at for paid plans; clear for free starter."""
    price = int(plan_limits(plan).get("price_irr") or 0)
    if price <= 0:
        org.plan_expires_at = None
        return
    now = datetime.utcnow()
    current = getattr(org, "plan_expires_at", None)
    base = current if current and current > now else now
    org.plan_expires_at = base + timedelta(days=days)


def ensure_bootstrap_seat(db: Session, org: Organization, user: User | None) -> str | None:
    """Create first extension seat if none; return plaintext token when newly created or existing plain."""
    existing = (
        db.query(ExtensionSeat)
        .filter(ExtensionSeat.org_id == org.id, ExtensionSeat.status != "revoked")
        .order_by(ExtensionSeat.created_at.asc())
        .first()
    )
    if existing:
        return getattr(existing, "token_plain", None) or None

    raw = new_raw_token()
    db.add(
        ExtensionSeat(
            org_id=org.id,
            label="صندلی مالک",
            token_prefix=raw[:12],
            token_hash=hash_token(raw),
            token_plain=raw,
            status="available",
            created_by_user_id=user.id if user else None,
        )
    )
    return raw


def apply_paid_plan(
    db: Session,
    org: Organization,
    *,
    plan: str,
    purpose: str,
    user: User | None = None,
    create_seat: bool = True,
) -> str | None:
    """Apply plan after successful payment. Returns bootstrap seat token if any."""
    org.plan = plan
    extend_subscription(org, plan=plan)
    if purpose == "onboarding":
        org.onboarding_step = "guides"
    db.add(org)
    token = None
    if create_seat:
        token = ensure_bootstrap_seat(db, org, user)
    return token


def mark_payment_paid(payment: Payment, *, ref_number: str = "", raw_verify: str = "") -> None:
    payment.status = "paid"
    payment.ref_number = ref_number or payment.ref_number or ""
    payment.raw_verify = raw_verify or payment.raw_verify or ""
    payment.paid_at = datetime.utcnow()


def mark_payment_failed(payment: Payment, *, raw_verify: str = "") -> None:
    payment.status = "failed"
    payment.raw_verify = raw_verify or payment.raw_verify or ""


def receipt_for(plan: str, *, ref: str, amount_irr: int | None = None) -> dict:
    meta = plan_limits(plan)
    return {
        "plan": plan,
        "amount_irr": amount_irr if amount_irr is not None else meta.get("price_irr", 0),
        "label": meta.get("price_label", ""),
        "ref": ref,
    }
