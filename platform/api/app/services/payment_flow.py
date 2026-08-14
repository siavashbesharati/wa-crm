"""Shared payment completion helpers (mock + Zibal callback)."""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Organization, Payment, User
from app.plans import plan_limits

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


def apply_paid_plan(
    db: Session,
    org: Organization,
    *,
    plan: str,
    purpose: str,
    user: User | None = None,
    create_seat: bool = False,
) -> str | None:
    """Apply plan after successful payment. create_seat is ignored (extension removed)."""
    _ = (user, create_seat)
    org.plan = plan
    extend_subscription(org, plan=plan)
    if purpose == "onboarding":
        org.onboarding_step = "ai_settings"
    db.add(org)
    return None


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
