"""Ephemeral chat presence (typing / online) keyed by org/lead."""

from __future__ import annotations

import threading
import time
from typing import Any

_lock = threading.Lock()
# key: f"{org_id}:{lead_id}" -> {state, account_id, external_chat_id, expires_at, last_seen?}
_store: dict[str, dict[str, Any]] = {}

DEFAULT_TTL_SEC = 6.0


def _key(org_id: str, lead_id: str) -> str:
    return f"{(org_id or '').strip()}:{(lead_id or '').strip()}"


def set_presence(
    *,
    org_id: str,
    lead_id: str,
    state: str,
    account_id: str = "",
    external_chat_id: str = "",
    ttl_sec: float = DEFAULT_TTL_SEC,
    last_seen: int | None = None,
) -> dict[str, Any]:
    st = (state or "").strip().lower()
    # Baileys WAPresence: composing/recording = typing; available = online; rest = clear
    if st in ("composing", "recording"):
        kind = "typing"
    elif st == "available":
        kind = "online"
    elif st in ("paused", "unavailable", "online", ""):
        st = "paused"
        kind = "clear"
    else:
        st = "paused"
        kind = "clear"

    k = _key(org_id, lead_id)
    now = time.time()
    with _lock:
        if kind == "clear":
            _store.pop(k, None)
            return {
                "lead_id": lead_id,
                "state": "paused",
                "typing": False,
                "online": False,
            }
        row: dict[str, Any] = {
            "org_id": org_id,
            "lead_id": lead_id,
            "account_id": account_id or "",
            "external_chat_id": external_chat_id or "",
            "state": st,
            "typing": kind == "typing",
            "online": kind == "online" or kind == "typing",
            "expires_at": now + max(2.0, float(ttl_sec or DEFAULT_TTL_SEC)),
        }
        if last_seen is not None:
            try:
                row["last_seen"] = int(last_seen)
            except (TypeError, ValueError):
                pass
        _store[k] = row
        return dict(row)


def get_presence(*, org_id: str, lead_id: str) -> dict[str, Any]:
    k = _key(org_id, lead_id)
    now = time.time()
    with _lock:
        row = _store.get(k)
        if not row:
            return {"lead_id": lead_id, "state": "paused", "typing": False, "online": False}
        if float(row.get("expires_at") or 0) <= now:
            _store.pop(k, None)
            return {"lead_id": lead_id, "state": "paused", "typing": False, "online": False}
        out = {
            "lead_id": lead_id,
            "state": row.get("state") or "composing",
            "typing": bool(row.get("typing")),
            "online": bool(row.get("online")),
            "account_id": row.get("account_id") or "",
        }
        if row.get("last_seen") is not None:
            out["last_seen"] = row["last_seen"]
        return out


def cleanup_expired() -> None:
    now = time.time()
    with _lock:
        dead = [k for k, v in _store.items() if float(v.get("expires_at") or 0) <= now]
        for k in dead:
            _store.pop(k, None)
