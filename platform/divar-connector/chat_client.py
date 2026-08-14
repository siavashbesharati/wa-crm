"""Authenticated Divar chat HTTP client (verified endpoints from DIVAR_CHAT_API.md)."""

from __future__ import annotations

import json
import logging
import random
import time
import uuid
from typing import Any

import requests

log = logging.getLogger("divar-connector.chat")

API = "https://api.divar.ir"
_UA = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
)


class DivarChatClient:
    def __init__(self, blob: dict[str, Any]):
        self.blob = blob
        self.session = requests.Session()
        self.session.headers.update(
            {
                "accept": "application/json, text/plain, */*",
                "accept-language": "en-US,en;q=0.9,fa;q=0.8",
                "origin": "https://divar.ir",
                "referer": "https://chat.divar.ir/",
                "user-agent": blob.get("user_agent") or _UA,
                "x-screen-size": blob.get("x_screen_size")
                or random.choice(["390x844", "430x932", "360x780"]),
            }
        )
        for name, value in (blob.get("cookies") or {}).items():
            self.session.cookies.set(name=name, value=value, domain=".divar.ir", path="/")

    def cookies_blob(self) -> dict[str, Any]:
        out = dict(self.blob)
        out["cookies"] = self.session.cookies.get_dict()
        return out

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", 30)
        for _ in range(3):
            r = self.session.request(method, url, **kwargs)
            if r.status_code == 403 and (r.text or "").lower() == "jwt is expired":
                self._refresh()
                continue
            return r
        return r

    def _refresh(self) -> None:
        r = self.session.post(f"{API}/v8/authenticate/session/refresh", data=b"{}", timeout=20)
        for name, value in r.cookies.items():
            self.session.cookies.set(name=name, value=value, domain=".divar.ir", path="/")
        front = r.headers.get("Front-Token")
        if not front:
            access = self.session.cookies.get("sAccessToken") or ""
            if access and "." in access:
                front = access.split(".")[1]
        if front:
            self.session.cookies.set(name="sFrontToken", value=front, domain=".divar.ir", path="/")

    def verify(self) -> bool:
        r = self._request("GET", f"{API}/v8/user-profile/user-nationality")
        return r.status_code == 200

    def list_conversations(self, page_size: int = 100) -> list[dict[str, Any]]:
        r = self._request(
            "POST",
            f"{API}/chat/api/conversations",
            json={
                "filter": {"filter": {"main_filter": {}}},
                "page_size": page_size,
            },
        )
        r.raise_for_status()
        return list((r.json() or {}).get("conversations") or [])

    def unread_conversation_ids(self) -> list[str]:
        try:
            r = self._request("POST", f"{API}/chat/api/unread-conversation-ids", json={})
            if r.status_code >= 400:
                return []
            data = r.json() or {}
            for key in ("conversation_ids", "ids", "unread_conversation_ids"):
                if isinstance(data.get(key), list):
                    return [str(x) for x in data[key]]
            if isinstance(data, list):
                return [str(x) for x in data]
        except Exception as exc:  # noqa: BLE001
            log.debug("unread-conversation-ids failed: %s", exc)
        return []

    def get_messages(self, conversation_id: str, limit: int = 50) -> list[dict[str, Any]]:
        r = self._request(
            "POST",
            f"{API}/chat/api/get-conversation-messages",
            json={
                "limit": limit,
                "conversation_id": conversation_id,
                "order": "DESC",
            },
        )
        r.raise_for_status()
        return list((r.json() or {}).get("messages") or [])

    def send_text(self, conversation_id: str, text: str) -> dict[str, Any]:
        client_reference = str(uuid.uuid4())
        r = self._request(
            "POST",
            f"{API}/chat/api/send-message",
            json={
                "conversation_id": conversation_id,
                "is_suggested": False,
                "client_reference": client_reference,
                "text": {"text": text},
            },
        )
        r.raise_for_status()
        return r.json() or {}


def parse_auth_blob(cookies_json: str) -> dict[str, Any] | None:
    if not (cookies_json or "").strip():
        return None
    try:
        data = json.loads(cookies_json)
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict) and "cookies" in data:
        return data
    if isinstance(data, dict):
        return {"cookies": data, "user_agent": "", "x_screen_size": ""}
    return None


def map_message(
    *,
    account_id: str,
    conversation: dict[str, Any],
    message: dict[str, Any],
) -> dict[str, Any] | None:
    mid = str(message.get("id") or "").strip()
    if not mid:
        return None
    text_content = message.get("text_content") or {}
    text = (text_content.get("text") if isinstance(text_content, dict) else "") or ""
    text = str(text).strip()
    if not text:
        return None

    conv_id = str(
        message.get("conversation_id") or conversation.get("id") or ""
    ).strip()
    meta = conversation.get("metadata") or {}
    peer = conversation.get("peer") or {}
    header = conversation.get("header") or {}
    peer_name = (peer.get("name") or "").strip() or "کاربر دیوار"
    ad_title = (
        (meta.get("title") or "").strip()
        or (header.get("title") or "").strip()
        or peer_name
    )
    post_token = (meta.get("ad_token") or "").strip()
    if not post_token:
        action = (header.get("action") or {}).get("payload") or {}
        post_token = str(action.get("token") or "").strip()

    from_me = bool(message.get("from_me"))
    return {
        "account_id": account_id,
        "chat_name": peer_name[:200],
        "body": text,
        "direction": "outbound" if from_me else "inbound",
        "phone": conv_id,
        "group_id": "",
        "external_chat_id": conv_id,
        "post_token": post_token,
        "ad_title": ad_title[:200],
        "chat_type": "pv",
        "external_message_id": f"divar:{mid}",
        "sender_type": "agent" if from_me else "customer",
        "media_type": "",
        "media_url": "",
        "trace_id": "",
    }
