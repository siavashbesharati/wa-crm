"""Shared payment completion helpers (mock + Zibal callback)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import ExtensionSeat, Organization, Payment, User
from app.plans import plan_limits
from app.services.seat_tokens import hash_token, new_raw_token


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
