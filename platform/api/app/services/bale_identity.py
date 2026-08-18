"""Keep Bale peer keys out of the WhatsApp JID / phone identity path."""

from __future__ import annotations

import re

from app.models import Lead, LeadAccountLink
from app.services.phone import try_normalize_ir_mobile

_PEER_KEY_RE = re.compile(r"^bale:(user|group):(\d+)$")
_MISSTAG_WA_RE = re.compile(r"^(\d+)@(?:s\.whatsapp\.net|c\.us)$", re.I)


def is_bale_key(value: str | None) -> bool:
    return bool(_PEER_KEY_RE.match((value or "").strip()))


def is_opaque_bale_name(value: str | None) -> bool:
    s = (value or "").strip()
    if not s:
        return True
    if s.startswith("bale:"):
        return True
    if "@s.whatsapp.net" in s.lower() or s.endswith("@c.us") or s.endswith("@lid"):
        return True
    return False


def parse_bale_peer(value: str | None) -> tuple[str, int] | None:
    raw = (value or "").strip()
    m = _PEER_KEY_RE.match(raw)
    if m:
        return m.group(1), int(m.group(2))
    return None


def bale_legacy_wa_jid(peer_id: int) -> str:
    return f"{int(peer_id)}@s.whatsapp.net"


def reconstruct_bale_key(
    value: str | None,
    *,
    chat_type: str = "pv",
) -> str:
    """Turn a Bale peer key or a mis-tagged WhatsApp JID into `bale:user|group:id`."""
    raw = (value or "").strip()
    parsed = parse_bale_peer(raw)
    if parsed:
        kind, pid = parsed
        return f"bale:{kind}:{pid}"
    m = _MISSTAG_WA_RE.match(raw)
    if m:
        kind = "group" if (chat_type or "").strip().lower() == "group" else "user"
        return f"bale:{kind}:{m.group(1)}"
    digits = re.sub(r"\D", "", raw)
    if digits and not try_normalize_ir_mobile(raw) and 6 <= len(digits) <= 12:
        # Bare Bale user id previously stored as Lead.phone
        kind = "group" if (chat_type or "").strip().lower() == "group" else "user"
        return f"bale:{kind}:{digits}"
    return ""


def is_bale_channel(source_channel: str | None, external_chat_id: str | None = None) -> bool:
    if (source_channel or "").strip().lower() == "bale":
        return True
    return (external_chat_id or "").strip().startswith("bale:")


def _peer_id_from_lead(lead: Lead) -> str:
    parsed = parse_bale_peer(lead.external_chat_id or "")
    if parsed:
        return str(parsed[1])
    m = _MISSTAG_WA_RE.match((lead.external_chat_id or "").strip())
    if m:
        return m.group(1)
    phone = (lead.phone or "").strip()
    m = _MISSTAG_WA_RE.match(phone)
    if m:
        return m.group(1)
    if phone.isdigit():
        return phone
    return ""


def heal_bale_lead(lead: Lead) -> bool:
    """Rewrite mis-tagged WhatsApp JIDs and fake phones on Bale leads. Returns True if changed."""
    if not is_bale_channel(lead.source_channel, lead.external_chat_id):
        # Still heal if the stored id is clearly a Bale key
        if not is_bale_key(lead.external_chat_id):
            return False

    changed = False
    chat_type = (lead.chat_type or "pv").strip().lower() or "pv"
    ext = (lead.external_chat_id or "").strip()
    fixed = reconstruct_bale_key(ext, chat_type=chat_type)
    if not fixed:
        fixed = reconstruct_bale_key(lead.phone or "", chat_type=chat_type)
        if fixed and not is_bale_key(fixed):
            fixed = ""
        # reconstruct from bare peer-id phone is OK
        if not is_bale_key(lead.external_chat_id or "") and (lead.phone or "").strip().isdigit():
            fixed = reconstruct_bale_key(lead.phone or "", chat_type=chat_type)

    if fixed and ext != fixed:
        lead.external_chat_id = fixed
        changed = True

    if not (lead.source_channel or "").strip():
        lead.source_channel = "bale"
        changed = True

    peer_id = _peer_id_from_lead(lead)
    phone = (lead.phone or "").strip()
    if phone:
        ir = try_normalize_ir_mobile(phone)
        digits = re.sub(r"\D", "", phone)
        fake_jid = phone.lower().endswith("@s.whatsapp.net") or phone.lower().endswith("@c.us")
        is_peer_id = bool(peer_id) and digits == peer_id
        if fake_jid or (is_peer_id and not ir):
            lead.phone = ""
            changed = True
        elif ir and phone != ir:
            lead.phone = ir
            changed = True

    if is_opaque_bale_name(lead.name) and (lead.name or "").endswith("@s.whatsapp.net"):
        key = (lead.external_chat_id or "").strip()
        if key and lead.name != key:
            lead.name = key
            changed = True
    return changed


def heal_bale_link(link: LeadAccountLink | None, bale_ext: str) -> bool:
    if not link or not bale_ext:
        return False
    cur = (link.external_chat_id or "").strip()
    if cur == bale_ext:
        return False
    if not cur or cur.endswith("@s.whatsapp.net") or cur.endswith("@c.us") or is_opaque_bale_name(cur):
        link.external_chat_id = bale_ext
        return True
    return False


def bale_lookup_ids(external_chat_id: str | None) -> list[str]:
    """Current Bale key plus the legacy WhatsApp form so we can heal in place."""
    ext = (external_chat_id or "").strip()
    out: list[str] = []
    parsed = parse_bale_peer(ext)
    if parsed:
        kind, pid = parsed
        out.append(f"bale:{kind}:{pid}")
        out.append(bale_legacy_wa_jid(pid))
        out.append(str(pid))
        return out
    rebuilt = reconstruct_bale_key(ext)
    if rebuilt:
        return bale_lookup_ids(rebuilt)
    if ext:
        out.append(ext)
    return out
