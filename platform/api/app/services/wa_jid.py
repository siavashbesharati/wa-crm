"""Resolve WhatsApp JIDs for Baileys outbound sends."""

from __future__ import annotations

import re

from app.models import Lead, LeadAccountLink

_PHONE_RE = re.compile(r"^\+?\d{8,15}$")


def _looks_like_phone(value: str | None) -> bool:
    t = re.sub(r"[\s\-()]", "", str(value or ""))
    return bool(_PHONE_RE.match(t))


def _is_wa_jid(value: str | None) -> bool:
    s = str(value or "")
    return (
        "@g.us" in s
        or "@c.us" in s
        or "@s.whatsapp.net" in s
        or "@lid" in s
    )


def normalize_to_jid(value: str | None) -> str:
    """Convert phone / JID / group id into a Baileys-sendable JID."""
    raw = (value or "").strip()
    if not raw:
        return ""
    if raw.startswith("bale:"):
        return raw
    if _is_wa_jid(raw):
        # Legacy @c.us → @s.whatsapp.net
        if raw.endswith("@c.us"):
            return raw[: -len("@c.us")] + "@s.whatsapp.net"
        return raw
    digits = re.sub(r"[\s\-()+]", "", raw)
    if _looks_like_phone(digits):
        return f"{digits.lstrip('+')}@s.whatsapp.net"
    return ""


def _looks_like_display_name(value: str) -> bool:
    t = (value or "").strip()
    if not t:
        return True
    if " " in t or t.startswith("~") or "کاربر" in t:
        return True
    return False


def resolve_target_jid(lead: Lead | None, link: LeadAccountLink | None = None) -> str:
    """Prefer stable chat ids; never return a display name as JID.

    Also returns Divar conversation ids and Bale peer keys (`bale:user:…` / `bale:group:…`).
    """
    candidates = (
        (link.external_chat_id if link else None),
        getattr(lead, "external_chat_id", None) if lead else None,
        getattr(lead, "wa_lid", None) if lead else None,
        getattr(lead, "group_id", None) if lead else None,
        getattr(lead, "phone", None) if lead else None,
    )
    for c in candidates:
        jid = normalize_to_jid(c)
        if jid:
            return jid
    for c in candidates:
        t = (c or "").strip()
        if t and not _looks_like_display_name(t) and len(t) >= 4:
            return t
    return ""


def resolve_outbound_target(lead: Lead | None, link: LeadAccountLink | None = None) -> str:
    """Display / extension target (may be name). Prefer ids when present."""
    if not lead:
        return ""
    for candidate in (
        (link.external_chat_id if link else None),
        getattr(lead, "external_chat_id", None),
        lead.phone,
        lead.group_id,
        lead.name,
    ):
        t = (candidate or "").strip()
        if t:
            return t
    return (lead.name or "").strip()
