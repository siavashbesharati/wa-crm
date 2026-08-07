"""Subscription plans — DB-backed with seeded defaults."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

DEFAULT_PLANS: dict[str, dict[str, Any]] = {
    "starter": {
        "label": "Starter",
        "max_channel_accounts": 9999,
        "max_seats": 2,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 30,
        "price_irr": 0,
        "price_label": "رایگان / آزمایشی",
        "features": [
            "۲ صندلی افزونه هم‌زمان",
            "همه کانال‌ها (واتساپ، دیوار، …)",
            "پیشنهاد پاسخ AI",
        ],
        "sort_order": 10,
        "is_active": True,
    },
    "growth": {
        "label": "Growth",
        "max_channel_accounts": 9999,
        "max_seats": 5,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 90,
        "price_irr": 990_000,
        "price_label": "۹۹۰٬۰۰۰ تومان / ماه",
        "features": [
            "۵ صندلی افزونه هم‌زمان",
            "همه کانال‌ها (واتساپ، دیوار، …)",
            "AI auto-send",
        ],
        "sort_order": 20,
        "is_active": True,
    },
    "scale": {
        "label": "Scale",
        "max_channel_accounts": 9999,
        "max_seats": 20,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 365,
        "price_irr": 2_490_000,
        "price_label": "۲٬۴۹۰٬۰۰۰ تومان / ماه",
        "features": [
            "۲۰ صندلی افزونه هم‌زمان",
            "همه کانال‌ها (واتساپ، دیوار، …)",
            "AI auto-send",
            "نگهداری پیام ۱ سال",
        ],
        "sort_order": 30,
        "is_active": True,
    },
}


def _session() -> Session:
    from app.database import SessionLocal

    return SessionLocal()


def _normalize_meta(meta: dict[str, Any]) -> dict[str, Any]:
    out = dict(meta)
    max_acc = int(out.get("max_channel_accounts") or out.get("max_wa_numbers") or 9999)
    out["max_channel_accounts"] = max_acc
    out["max_wa_numbers"] = max_acc
    out["max_seats"] = int(out.get("max_seats") or 1)
    out["ai_suggest"] = bool(out.get("ai_suggest", True))
    out["ai_auto_send"] = bool(out.get("ai_auto_send", False))
    out["message_retention_days"] = int(out.get("message_retention_days") or 30)
    out["price_irr"] = int(out.get("price_irr") or 0)
    out["price_label"] = str(out.get("price_label") or "")
    out["label"] = str(out.get("label") or out.get("id") or "")
    feats = out.get("features") or []
    if not isinstance(feats, list):
        feats = []
    out["features"] = [str(x).strip() for x in feats if str(x).strip()]
    out["channels_unlimited"] = True
    out["sort_order"] = int(out.get("sort_order") or 0)
    out["is_active"] = bool(out.get("is_active", True))
    return out


def row_to_meta(row) -> dict[str, Any]:
    return _normalize_meta(
        {
            "id": row.id,
            "label": row.label,
            "max_channel_accounts": row.max_channel_accounts,
            "max_seats": row.max_seats,
            "ai_suggest": row.ai_suggest,
            "ai_auto_send": row.ai_auto_send,
            "message_retention_days": row.message_retention_days,
            "price_irr": row.price_irr,
            "price_label": row.price_label,
            "features": list(row.features or []),
            "sort_order": row.sort_order,
            "is_active": row.is_active,
        }
    )


def ensure_default_plans(db: Session | None = None) -> None:
    """Seed default plans if table empty."""
    from app.models import PricingPlan

    owns = db is None
    session = db or _session()
    try:
        count = session.query(PricingPlan).count()
        if count > 0:
            # All subscriptions can use AI (suggest + auto-send).
            dirty = False
            for row in session.query(PricingPlan).all():
                if not row.ai_suggest or not row.ai_auto_send:
                    row.ai_suggest = True
                    row.ai_auto_send = True
                    dirty = True
            if dirty:
                session.commit()
            return
        for pid, meta in DEFAULT_PLANS.items():
            session.add(
                PricingPlan(
                    id=pid,
                    label=meta["label"],
                    price_irr=int(meta["price_irr"]),
                    price_label=meta["price_label"],
                    max_seats=int(meta["max_seats"]),
                    max_channel_accounts=int(meta["max_channel_accounts"]),
                    ai_suggest=bool(meta["ai_suggest"]),
                    ai_auto_send=bool(meta["ai_auto_send"]),
                    message_retention_days=int(meta["message_retention_days"]),
                    features=list(meta.get("features") or []),
                    sort_order=int(meta.get("sort_order") or 0),
                    is_active=True,
                )
            )
        session.commit()
    finally:
        if owns:
            session.close()


def load_plans(*, active_only: bool = False, db: Session | None = None) -> dict[str, dict[str, Any]]:
    from app.models import PricingPlan

    owns = db is None
    session = db or _session()
    try:
        ensure_default_plans(session)
        q = session.query(PricingPlan).order_by(PricingPlan.sort_order.asc(), PricingPlan.id.asc())
        if active_only:
            q = q.filter(PricingPlan.is_active.is_(True))
        rows = q.all()
        if not rows and not active_only:
            # fallback if seed somehow failed
            return {k: _normalize_meta({**v, "id": k}) for k, v in DEFAULT_PLANS.items()}
        return {r.id: row_to_meta(r) for r in rows}
    finally:
        if owns:
            session.close()


def plan_exists(plan_id: str, *, db: Session | None = None) -> bool:
    return (plan_id or "").strip() in load_plans(active_only=False, db=db)


def plan_limits(plan: str, *, db: Session | None = None) -> dict[str, Any]:
    plans = load_plans(active_only=False, db=db)
    if plan in plans:
        return dict(plans[plan])
    if "starter" in plans:
        return dict(plans["starter"])
    return _normalize_meta({**DEFAULT_PLANS["starter"], "id": "starter"})


def list_plans_public(*, db: Session | None = None) -> list[dict[str, Any]]:
    out = []
    for key, meta in load_plans(active_only=True, db=db).items():
        item = dict(meta)
        item["id"] = key
        out.append(item)
    return out


def list_plans_admin(*, db: Session | None = None) -> list[dict[str, Any]]:
    out = []
    for key, meta in load_plans(active_only=False, db=db).items():
        item = dict(meta)
        item["id"] = key
        out.append(item)
    return out


# Backward-compatible mapping for `plan in PLANS` / PLANS.get(...)
class _PlansMap:
    def __contains__(self, key: object) -> bool:
        return isinstance(key, str) and plan_exists(key)

    def get(self, key: str, default: Any = None) -> Any:
        plans = load_plans(active_only=False)
        if key in plans:
            return plans[key]
        return default

    def keys(self):
        return load_plans(active_only=False).keys()

    def items(self):
        return load_plans(active_only=False).items()

    def __iter__(self):
        return iter(self.keys())


PLANS = _PlansMap()
