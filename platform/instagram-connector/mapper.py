"""Map Instagram realtime DM events onto Bidar ingest payloads. No session IDs here."""

from __future__ import annotations

import re
from typing import Any

_PREFIXED_TARGET_RE = re.compile(r"^instagram:thread:(\d{1,64})$")
_BARE_TARGET_RE = re.compile(r"^(\d{10,64})$")

_AUTH_NEEDLES = (
    "login_required",
    "challenge_required",
    "bad_password",
    "checkpoint",
    "unauthorized",
    "unauthenticated",
    "401",
    "403",
    "sessionid",
    "invalid session",
    "not logged in",
)

_RATE_LIMIT_NEEDLES = ("429", "too many requests", "rate limit")


def is_rate_limited(exc: BaseException) -> bool:
    name = type(exc).__name__.lower()
    msg = str(exc or "").lower()
    for needle in _RATE_LIMIT_NEEDLES:
        if needle in name or needle in msg:
            return True
    return False


class AuthRequired(Exception):
    """Stored Instagram session is missing or rejected by the server."""


class RateLimited(Exception):
    """Instagram throttled us (429) — session may still be valid; retry later."""


def is_auth_failure(exc: BaseException) -> bool:
    if is_rate_limited(exc):
        return False
    name = type(exc).__name__.lower()
    msg = str(exc or "").lower()
    for needle in _AUTH_NEEDLES:
        if needle in name or needle in msg:
            return True
    return False


def extract_thread_id(path: Any) -> str:
    """Extract thread id from /direct_v2/threads/<id>/items/<id>."""
    if not isinstance(path, str):
        return ""
    parts = path.split("/")
    try:
        index = parts.index("threads")
        return str(parts[index + 1] or "")
    except (ValueError, IndexError):
        return ""


def thread_key(thread_id: str | int) -> str:
    return f"instagram:thread:{int(thread_id)}"


def parse_thread_target(value: str | None) -> int | None:
    raw = (value or "").strip()
    m = _PREFIXED_TARGET_RE.match(raw)
    if m:
        return int(m.group(1))
    m = _BARE_TARGET_RE.match(raw)
    if m:
        return int(m.group(1))
    return None


def external_message_id(item_id: str | int) -> str:
    return f"ig:{item_id}"


def display_name(username: str, user_id: Any) -> str:
    u = (username or "").strip().lstrip("@")
    if u:
        return f"@{u}"
    return f"ig:{user_id}"


def map_realtime_dm(
    *,
    account_id: str,
    message: dict[str, Any],
    me_id: int | str | None,
    username: str = "",
) -> dict[str, Any] | None:
    """Normalize one realtime Direct item into an ingest payload.

    Returns None for unsupported/non-text items, own messages and malformed events.
    """
    if not isinstance(message, dict):
        return None

    text = message.get("text")
    item_type = str(message.get("item_type") or "")
    if item_type != "text" or not text:
        return None

    thread_id = str(message.get("thread_id") or "") or extract_thread_id(message.get("path"))
    if not thread_id:
        return None

    user_id = message.get("user_id")
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return None
    try:
        if me_id and uid == int(me_id):
            return None
    except (TypeError, ValueError):
        pass

    item_id = str(message.get("item_id") or message.get("message_id") or "").strip()
    if not item_id:
        return None

    return {
        "account_id": account_id,
        "chat_name": display_name(username, uid),
        "body": str(text),
        "direction": "inbound",
        "phone": "",
        "group_id": "",
        "external_chat_id": thread_id,
        "chat_type": "pv",
        "external_message_id": external_message_id(item_id),
        "sender_type": "customer",
        "media_type": "text",
    }
