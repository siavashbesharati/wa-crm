"""Map Bale peers/messages onto Bidar ingest payloads. No tokens here."""

from __future__ import annotations

import json
import re
from typing import Any

PEER_USER = 1
PEER_GROUP = 2

_PEER_KEY_RE = re.compile(r"^bale:(user|group):(\d+)$")
_MISSTAG_WA_RE = re.compile(r"^(\d+)@(?:s\.whatsapp\.net|c\.us)$", re.I)
_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_IR_LOCAL = re.compile(r"^09\d{9}$")


class AuthRequired(Exception):
    """Stored Bale session is missing or rejected by the server."""


def is_auth_failure(exc: BaseException) -> bool:
    msg = str(exc or "").lower()
    needles = (
        "unauthorized",
        "unauthenticated",
        "forbidden",
        "401",
        "403",
        "jwt",
        "access denied",
        "not logged in",
        "invalid session",
    )
    return any(n in msg for n in needles)


def parse_token_blob(raw: str | dict[str, Any] | None) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        token = str(raw.get("access_token") or "").strip()
        return raw if token else None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not str(data.get("access_token") or "").strip():
        return None
    return data


def peer_kind(peer_type: int) -> str:
    return "user" if int(peer_type) == PEER_USER else "group"


def peer_key(peer_type: int, peer_id: int) -> str:
    return f"bale:{peer_kind(peer_type)}:{int(peer_id)}"


def parse_peer_key(value: str | None) -> tuple[str, int] | None:
    raw = (value or "").strip()
    m = _PEER_KEY_RE.match(raw)
    if m:
        return m.group(1), int(m.group(2))
    # CRM used to rewrite Bale peer ids as WhatsApp JIDs — still sendable as a user.
    m = _MISSTAG_WA_RE.match(raw)
    if m:
        return "user", int(m.group(1))
    if raw.isdigit():
        return "user", int(raw)
    return None


def _sv(value: Any) -> str:
    if value is None:
        return ""
    inner = getattr(value, "value", value)
    if isinstance(inner, (bytes, bytearray)):
        return inner.decode("utf-8", "replace").strip()
    return str(inner or "").strip()


def normalize_visible_phone(raw: str | None) -> str:
    """Keep a real mobile for CRM display. Never treat a Bale user id as a phone."""
    d = re.sub(r"\D", "", (raw or "").translate(_PERSIAN_DIGITS))
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("98") and len(d) == 12:
        d = "0" + d[2:]
    elif d.startswith("9") and len(d) == 10:
        d = "0" + d
    return d if _IR_LOCAL.fullmatch(d) else ""


def phone_from_contact_records(records: Any) -> str:
    for item in records or []:
        for raw in (
            _sv(getattr(item, "stringValue", None)),
            _sv(getattr(item, "title", None)),
            _sv(getattr(item, "subtitle", None)),
            _sv(getattr(item, "longValue", None)),
        ):
            phone = normalize_visible_phone(raw)
            if phone:
                return phone
    return ""


def peer_display_name(title: str | None, username: str | None, ext: str) -> str:
    t = (title or "").strip()
    if t and t != ext and not t.startswith("bale:"):
        return t
    u = (username or "").strip().lstrip("@")
    if u:
        return f"@{u}"
    return ext


def message_external_id(peer_type: int, peer_id: int, rid: int) -> str:
    return f"bale:{int(peer_type)}:{int(peer_id)}:{int(rid)}"


def content_body(content: Any) -> tuple[str, str]:
    """Return (body, media_type) from a bale.normalize.Content or similar."""
    if content is None:
        return "", ""
    kind = str(getattr(content, "kind", "") or "")
    text = getattr(content, "text", None)
    if kind == "text":
        return str(text or ""), "text"
    if kind == "media":
        media = getattr(content, "media", None)
        caption = getattr(media, "caption", None) if media is not None else None
        media_kind = str(getattr(media, "kind", "") or "document") if media is not None else "document"
        body = str(caption or "").strip() or f"[{media_kind}]"
        mapped = {
            "photo": "image",
            "video": "video",
            "voice": "audio",
            "audio": "audio",
            "gif": "video",
            "document": "document",
        }.get(media_kind, "document")
        return body, mapped
    if kind == "sticker":
        return "[sticker]", "image"
    if kind == "service":
        return str(text or "[service]"), "text"
    if kind in ("empty", ""):
        return "", ""
    return str(text or f"[{kind}]"), kind or "text"


def map_history_message(
    *,
    account_id: str,
    peer_type: int,
    peer_id: int,
    title: str,
    entry: Any,
    me_id: int | None,
    username: str = "",
    phone: str = "",
) -> dict[str, Any] | None:
    rid = int(getattr(entry, "rid", 0) or 0)
    if not rid:
        return None
    sender_id = int(getattr(entry, "sender_id", 0) or 0)
    body, media_type = content_body(getattr(entry, "content", None))
    if not body and not media_type:
        return None
    is_group = int(peer_type) != PEER_USER
    from_me = bool(me_id and sender_id and sender_id == int(me_id))
    ext = peer_key(peer_type, peer_id)
    phone = "" if is_group else normalize_visible_phone(phone)
    chat_name = peer_display_name(title, username, ext)
    return {
        "account_id": account_id,
        "chat_name": chat_name,
        "body": body,
        "direction": "outbound" if from_me else "inbound",
        "phone": phone,
        "group_id": str(peer_id) if is_group else "",
        "external_chat_id": ext,
        "chat_type": "group" if is_group else "pv",
        "external_message_id": message_external_id(peer_type, peer_id, rid),
        "sender_type": "agent" if from_me else "customer",
        "media_type": media_type,
    }


def map_new_message_event(
    *,
    account_id: str,
    event: Any,
    title: str,
    me_id: int | None,
    username: str = "",
    phone: str = "",
) -> dict[str, Any] | None:
    peer = getattr(event, "peer", None)
    if peer is None:
        return None
    peer_type = int(getattr(peer, "type", PEER_USER) or PEER_USER)
    peer_id = int(getattr(peer, "id", 0) or 0)
    rid = int(getattr(event, "id", 0) or getattr(event, "rid", 0) or 0)
    if not peer_id or not rid:
        return None
    sender_id = int(getattr(event, "sender_id", 0) or 0)
    body, media_type = content_body(getattr(event, "content", None))
    text = getattr(event, "text", None)
    if text:
        body = str(text)
        media_type = media_type or "text"
    if not body and not media_type:
        return None
    is_group = bool(getattr(event, "is_group", False)) or peer_type != PEER_USER
    from_me = bool(me_id and sender_id and sender_id == int(me_id))
    ext = peer_key(peer_type, peer_id)
    chat_name = peer_display_name(title, username, ext)
    return {
        "account_id": account_id,
        "chat_name": chat_name,
        "body": body,
        "direction": "outbound" if from_me else "inbound",
        "phone": "" if is_group else normalize_visible_phone(phone),
        "group_id": str(peer_id) if is_group else "",
        "external_chat_id": ext,
        "chat_type": "group" if is_group else "pv",
        "external_message_id": message_external_id(peer_type, peer_id, rid),
        "sender_type": "agent" if from_me else "customer",
        "media_type": media_type,
    }
