PLANS = {
    "starter": {
        "label": "Starter",
        # Channels are unlimited on all plans; billing is by concurrent extension seats.
        "max_channel_accounts": 9999,
        "max_wa_numbers": 9999,
        "max_seats": 2,
        "ai_suggest": True,
        "ai_auto_send": False,
        "message_retention_days": 30,
        "price_irr": 0,
        "price_label": "رایگان / آزمایشی",
    },
    "growth": {
        "label": "Growth",
        "max_channel_accounts": 9999,
        "max_wa_numbers": 9999,
        "max_seats": 5,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 90,
        "price_irr": 990_000,
        "price_label": "۹۹۰٬۰۰۰ تومان / ماه",
    },
    "scale": {
        "label": "Scale",
        "max_channel_accounts": 9999,
        "max_wa_numbers": 9999,
        "max_seats": 20,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 365,
        "price_irr": 2_490_000,
        "price_label": "۲٬۴۹۰٬۰۰۰ تومان / ماه",
    },
}


def plan_limits(plan: str) -> dict:
    limits = dict(PLANS.get(plan, PLANS["starter"]))
    max_acc = limits.get("max_channel_accounts") or limits.get("max_wa_numbers") or 9999
    limits["max_channel_accounts"] = max_acc
    limits["max_wa_numbers"] = max_acc
    limits["max_seats"] = int(limits.get("max_seats") or 1)
    limits["channels_unlimited"] = True
    return limits


def list_plans_public() -> list[dict]:
    out = []
    for key, meta in PLANS.items():
        item = plan_limits(key)
        item["id"] = key
        out.append(item)
    return out
