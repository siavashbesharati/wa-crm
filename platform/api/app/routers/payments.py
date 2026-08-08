"""Payment config, Zibal callback, and renew/upgrade start skeleton."""

from __future__ import annotations

import json
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import AuthContext, require_roles
from app.models import MemberRole, Organization, Payment, User
from app.plans import plan_exists, plan_limits
from app.services.payment_flow import (
    apply_paid_plan,
    mark_payment_failed,
    mark_payment_paid,
    receipt_for,
)
from app.services import zibal_payment

router = APIRouter(prefix="/payments", tags=["payments"])


class PaymentStartIn(BaseModel):
    purpose: str = Field(pattern="^(renew|upgrade)$")
    plan: str


def _post_pay_path(purpose: str) -> str:
    if purpose == "onboarding":
        return "onboarding"
    return "billing"


def _provider() -> str:
    p = (get_settings().payment_provider or "mock").strip().lower()
    return p if p in ("mock", "zibal") else "mock"


@router.get("/history")
def payment_history(
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Payment)
        .filter(Payment.org_id == auth.org.id)
        .order_by(Payment.created_at.desc())
        .limit(100)
        .all()
    )
    return {
        "payments": [
            {
                "id": p.id,
                "purpose": p.purpose,
                "plan": p.plan,
                "amount_irr": int(p.amount_irr or 0),
                "provider": p.provider,
                "status": p.status,
                "ref_number": p.ref_number or "",
                "track_id": p.track_id or "",
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            }
            for p in rows
        ]
    }


@router.get("/config")
def payments_config():
    settings = get_settings()
    return {
        "provider": _provider(),
        "merchant_configured": bool(settings.zibal_merchant_id),
        "test_merchant": settings.zibal_merchant_id == "zibal",
    }


def _start_zibal_payment(
    db: Session,
    *,
    org: Organization,
    user: User,
    plan: str,
    purpose: str,
) -> dict:
    if not plan_exists(plan):
        raise HTTPException(status_code=400, detail="پلن نامعتبر است")
    meta = plan_limits(plan)
    amount = int(meta.get("price_irr") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="این پلن نیاز به پرداخت ندارد")

    payment = Payment(
        org_id=org.id,
        user_id=user.id,
        purpose=purpose,
        plan=plan,
        amount_irr=amount,
        provider="zibal",
        status="pending",
    )
    db.add(payment)
    db.flush()

    req = zibal_payment.request_payment(
        amount,
        description=f"{purpose}:{plan}:{org.id[:8]}",
    )
    payment.raw_request = req.get("raw_json") or ""
    if not req.get("ok") or not req.get("track_id"):
        payment.status = "failed"
        db.add(payment)
        db.commit()
        raise HTTPException(
            status_code=502,
            detail=req.get("message") or "خطا در ایجاد تراکنش زیبال",
        )

    payment.track_id = str(req["track_id"])
    db.add(payment)
    db.commit()
    db.refresh(payment)

    return {
        "ok": True,
        "provider": "zibal",
        "payment_id": payment.id,
        "track_id": payment.track_id,
        "payment_url": req["payment_url"],
        "amount_irr": amount,
        "plan": plan,
        "purpose": purpose,
    }


@router.post("/start")
def start_payment(
    body: PaymentStartIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner)),
    db: Session = Depends(get_db),
):
    """Skeleton: renew / upgrade via Zibal (or mock instant for local)."""
    purpose = body.purpose
    plan = body.plan.strip()
    if not plan_exists(plan):
        raise HTTPException(status_code=400, detail="پلن نامعتبر است")

    provider = _provider()
    meta = plan_limits(plan)
    amount = int(meta.get("price_irr") or 0)

    if amount <= 0 or provider == "mock":
        # ensure_bootstrap_seat only creates when none exist
        token = apply_paid_plan(
            db,
            auth.org,
            plan=plan,
            purpose=purpose,
            user=auth.user,
            create_seat=True,
        )
        payment = Payment(
            org_id=auth.org.id,
            user_id=auth.user.id,
            purpose=purpose,
            plan=plan,
            amount_irr=amount,
            provider="mock",
            status="paid",
            ref_number="MOCK-" + auth.org.id[:8].upper(),
            raw_request=json.dumps(
                {"provider": "mock", "purpose": purpose, "plan": plan, "amount_irr": amount},
                ensure_ascii=False,
            ),
            raw_verify=json.dumps({"ok": True, "mock": True}, ensure_ascii=False),
        )
        mark_payment_paid(payment, ref_number=payment.ref_number)
        db.add(payment)
        db.commit()
        return {
            "ok": True,
            "provider": "mock",
            "paid": True,
            "plan": plan,
            "purpose": purpose,
            "bootstrap_seat_token": token,
            "receipt": receipt_for(plan, ref=payment.ref_number, amount_irr=amount),
        }

    return _start_zibal_payment(
        db, org=auth.org, user=auth.user, plan=plan, purpose=purpose
    )


@router.get("/zibal/callback")
def zibal_callback(
    trackId: str | None = Query(default=None),
    track_id: str | None = Query(default=None),
    success: int | None = Query(default=None),
    status: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Browser redirect from Zibal — verify and apply plan."""
    settings = get_settings()
    web = settings.web_base_url.rstrip("/")
    tid = (trackId or track_id or "").strip()
    if not tid:
        q = urlencode({"paid": "0", "error": "missing_track"})
        return RedirectResponse(f"{web}/onboarding?{q}", status_code=302)

    payment = (
        db.query(Payment)
        .filter(Payment.track_id == tid, Payment.provider == "zibal")
        .order_by(Payment.created_at.desc())
        .first()
    )
    if not payment:
        q = urlencode({"paid": "0", "error": "payment_not_found"})
        return RedirectResponse(f"{web}/onboarding?{q}", status_code=302)

    payment.raw_callback = json.dumps(
        {
            "trackId": tid,
            "success": success,
            "status": status,
        },
        ensure_ascii=False,
    )
    db.add(payment)
    db.flush()

    org = db.get(Organization, payment.org_id)
    user = db.get(User, payment.user_id) if payment.user_id else None
    if not org:
        q = urlencode({"paid": "0", "error": "org_not_found"})
        return RedirectResponse(f"{web}/onboarding?{q}", status_code=302)

    # Already paid — idempotent
    if payment.status == "paid":
        dest = _post_pay_path(payment.purpose)
        q = urlencode({"paid": "1", "ref": payment.ref_number or ""})
        return RedirectResponse(f"{web}/{dest}?{q}", status_code=302)

    # Zibal callback: success=1 + status=2 means paid-but-unverified (must verify).
    # status=2 is NOT a failure. Fail only when success=0 or explicit cancel/fail statuses.
    # Status ref: -1 waiting, 2 paid unverified, 1 paid verified, 3 user cancel, 4+ gateway errors.
    fail_statuses = {3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 18, 21}
    if success == 0 or (status is not None and status in fail_statuses):
        mark_payment_failed(
            payment,
            raw_verify=json.dumps(
                {"cancelled_or_failed": True, "success": success, "status": status},
                ensure_ascii=False,
            ),
        )
        db.add(payment)
        db.commit()
        dest = _post_pay_path(payment.purpose)
        err = "cancelled" if status == 3 else f"gateway_status_{status or 0}"
        q = urlencode({"paid": "0", "error": err})
        return RedirectResponse(f"{web}/{dest}?{q}", status_code=302)

    verified = zibal_payment.verify_payment(tid)
    payment.raw_verify = verified.get("raw_json") or ""
    if not verified.get("ok"):
        mark_payment_failed(payment, raw_verify=payment.raw_verify)
        db.add(payment)
        db.commit()
        dest = _post_pay_path(payment.purpose)
        q = urlencode(
            {
                "paid": "0",
                "error": verified.get("message") or "verify_failed",
            }
        )
        return RedirectResponse(f"{web}/{dest}?{q}", status_code=302)

    mark_payment_paid(
        payment,
        ref_number=verified.get("ref_number") or "",
        raw_verify=payment.raw_verify,
    )
    apply_paid_plan(
        db,
        org,
        plan=payment.plan,
        purpose=payment.purpose,
        user=user,
        create_seat=True,
    )
    db.add(payment)
    db.commit()

    dest = _post_pay_path(payment.purpose)
    q = urlencode({"paid": "1", "ref": payment.ref_number or ""})
    return RedirectResponse(f"{web}/{dest}?{q}", status_code=302)
