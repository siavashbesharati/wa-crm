PLANS = {
    "starter": {
        "label": "Starter",
        "max_channel_accounts": 2,
        "max_wa_numbers": 2,  # alias of max_channel_accounts
        "max_seats": 3,
        "ai_suggest": True,
        "ai_auto_send": False,
        "message_retention_days": 30,
    },
    "growth": {
        "label": "Growth",
        "max_channel_accounts": 6,
        "max_wa_numbers": 6,
        "max_seats": 10,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 90,
    },
    "scale": {
        "label": "Scale",
        "max_channel_accounts": 20,
        "max_wa_numbers": 20,
        "max_seats": 50,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 365,
    },
}


def plan_limits(plan: str) -> dict:
    limits = dict(PLANS.get(plan, PLANS["starter"]))
    # Keep both keys in sync for older clients
    max_acc = limits.get("max_channel_accounts") or limits.get("max_wa_numbers") or 1
    limits["max_channel_accounts"] = max_acc
    limits["max_wa_numbers"] = max_acc
    return limits
