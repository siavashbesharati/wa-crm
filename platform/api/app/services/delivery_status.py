"""Map WhatsApp / Baileys ack codes onto CRM delivery_status."""

from __future__ import annotations

# Ranked ladder — never downgrade
_RANK = {
    "": 0,
    "pending": 1,
    "sent": 2,
    "delivered": 3,
    "read": 4,
    "played": 5,
}

# Baileys WAMessageStatus numeric (common)
_STATUS_NUM = {
    0: "pending",  # ERROR treated as pending for UI
    1: "pending",
    2: "sent",  # SERVER_ACK
    3: "delivered",  # DELIVERY_ACK
    4: "read",  # READ
    5: "played",  # PLAYED
}

_STATUS_STR = {
    "error": "pending",
    "pending": "pending",
    "server_ack": "sent",
    "server": "sent",
    "delivery_ack": "delivered",
    "delivery": "delivered",
    "delivered": "delivered",
    "read": "read",
    "played": "played",
}


def normalize_delivery_status(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, (int, float)):
        return _STATUS_NUM.get(int(value), "")
    raw = str(value).strip().lower()
    if not raw:
        return ""
    if raw.isdigit():
        return _STATUS_NUM.get(int(raw), "")
    return _STATUS_STR.get(raw, raw if raw in _RANK else "")


def merge_delivery_status(current: str | None, incoming: str | None) -> str:
    cur = normalize_delivery_status(current or "")
    nxt = normalize_delivery_status(incoming or "")
    if not nxt:
        return cur
    if _RANK.get(nxt, 0) >= _RANK.get(cur, 0):
        return nxt
    return cur
