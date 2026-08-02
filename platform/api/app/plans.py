PLANS = {
    "starter": {
        "label": "Starter",
        "max_wa_numbers": 1,
        "max_seats": 3,
        "ai_suggest": True,
        "ai_auto_send": False,
        "message_retention_days": 30,
    },
    "growth": {
        "label": "Growth",
        "max_wa_numbers": 3,
        "max_seats": 10,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 90,
    },
    "scale": {
        "label": "Scale",
        "max_wa_numbers": 10,
        "max_seats": 50,
        "ai_suggest": True,
        "ai_auto_send": True,
        "message_retention_days": 365,
    },
}


def plan_limits(plan: str) -> dict:
    return PLANS.get(plan, PLANS["starter"])
