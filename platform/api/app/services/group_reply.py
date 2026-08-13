"""Group chat auto-reply policy: off (default) or keyword-triggered."""

from __future__ import annotations

from typing import Any


GROUP_REPLY_OFF = "off"
GROUP_REPLY_KEYWORDS = "keywords"
GROUP_REPLY_MODES = (GROUP_REPLY_OFF, GROUP_REPLY_KEYWORDS)


def normalize_group_reply_mode(raw: Any, *, legacy_enabled: bool = False) -> str:
    mode = str(raw or "").strip().lower()
    if mode in GROUP_REPLY_MODES:
        return mode
    # Backward compat: old boolean group_auto_send_enabled
    return GROUP_REPLY_KEYWORDS if legacy_enabled else GROUP_REPLY_OFF


def normalize_group_keywords(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = raw.replace("\n", ",").split(",")
    elif isinstance(raw, (list, tuple)):
        parts = list(raw)
    else:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        kw = str(part or "").strip()
        if not kw:
            continue
        key = kw.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(kw)
    return out


def resolve_group_reply_mode(policy: Any) -> str:
    legacy = bool(getattr(policy, "group_auto_send_enabled", False))
    return normalize_group_reply_mode(
        getattr(policy, "group_reply_mode", None),
        legacy_enabled=legacy,
    )


def group_keyword_hit(message: str, keywords: list[str]) -> str | None:
    """Return the matched keyword, or None."""
    text = (message or "").casefold()
    if not text:
        return None
    for kw in keywords:
        needle = (kw or "").strip().casefold()
        if needle and needle in text:
            return kw.strip()
    return None


def lead_looks_like_group(
    lead: Any = None,
    *,
    chat_type: str = "",
    group_id: str = "",
    external_chat_id: str = "",
) -> bool:
    """True if this conversation should follow group auto-reply rules."""
    ctype = (chat_type or getattr(lead, "chat_type", None) or "pv").strip().lower()
    gid = (group_id or getattr(lead, "group_id", None) or "").strip()
    ext = (external_chat_id or getattr(lead, "external_chat_id", None) or "").strip()
    if ctype == "group":
        return True
    if gid:
        return True
    if ext.startswith("gname:"):
        return True
    if "@g.us" in gid.lower() or ext.lower().endswith("@g.us") or "@g.us" in ext.lower():
        return True
    return False


def evaluate_group_auto_reply(policy: Any, message: str) -> tuple[bool, str]:
    """
    Decide whether a group inbound should get AI auto-reply.
    Returns (allow, reason_code).
    """
    mode = resolve_group_reply_mode(policy)
    if mode == GROUP_REPLY_OFF:
        return False, "group_reply_disabled"
    if mode == GROUP_REPLY_KEYWORDS:
        keywords = normalize_group_keywords(getattr(policy, "group_keywords", None))
        if not keywords:
            return False, "group_keywords_empty"
        hit = group_keyword_hit(message, keywords)
        if not hit:
            return False, "group_keyword_miss"
        return True, f"group_keyword:{hit}"
    return False, "group_reply_disabled"
