from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any

from api_client import api
from chat_client import DivarChatClient, map_message, parse_auth_blob
from config import FIRST_SYNC_LOOKBACK_SEC

log = logging.getLogger("divar-connector.session")


def _parse_sent_at(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


class SessionHandle:
    def __init__(self, account_id: str):
        self.account_id = account_id
        self.client: DivarChatClient | None = None
        self.connected = False
        self._stop = threading.Event()
        self._cursors: dict[str, str] = {}
        self._known_conversations: set[str] = set()
        self._lock = threading.Lock()

    def stop(self) -> None:
        self._stop.set()
        self.connected = False
        self.client = None

    def start(self) -> None:
        auth = api.get_auth(self.account_id)
        blob = parse_auth_blob(auth.get("cookies_json") or "")
        if not blob:
            log.warning("[%s] no cookies — waiting for OTP pair", self.account_id)
            return
        try:
            cursors = json.loads(auth.get("cursors_json") or "{}")
            if isinstance(cursors, dict):
                self._cursors = {str(k): str(v) for k, v in cursors.items()}
        except json.JSONDecodeError:
            self._cursors = {}

        client = DivarChatClient(blob)
        if not client.verify():
            log.error("[%s] cookie session invalid", self.account_id)
            api.put_pair_state(self.account_id, pairing_state="disconnected", status="offline")
            return
        self.client = client
        self.connected = True
        api.put_pair_state(self.account_id, pairing_state="connected", status="online")
        log.info("[%s] Divar session ready", self.account_id)

    def persist_cookies(self) -> None:
        if not self.client:
            return
        api.put_auth(
            self.account_id,
            cookies_json=json.dumps(self.client.cookies_blob(), ensure_ascii=False),
            cursors_json=json.dumps(self._cursors, ensure_ascii=False),
        )

    def persist_cursors(self) -> None:
        api.put_cursors(self.account_id, self._cursors)

    def sync_inbound(self) -> None:
        if not self.client or not self.connected:
            return
        try:
            conversations = self.client.list_conversations(page_size=100)
        except Exception as exc:  # noqa: BLE001
            log.warning("[%s] list conversations failed: %s", self.account_id, exc)
            self.connected = False
            return

        unread = set(self.client.unread_conversation_ids())
        now = datetime.now(timezone.utc)
        dirty = False

        for conv in conversations:
            if self._stop.is_set():
                return
            conv_id = str(conv.get("id") or "").strip()
            if not conv_id:
                continue
            preview = conv.get("preview") or {}
            is_new = conv_id not in self._cursors
            should_fetch = (
                conv_id in unread
                or (not preview.get("from_me", True))
                or is_new
                or conv_id not in self._known_conversations
            )
            self._known_conversations.add(conv_id)
            if not should_fetch:
                continue

            try:
                messages = self.client.get_messages(conv_id, limit=40)
            except Exception as exc:  # noqa: BLE001
                log.debug("[%s] get_messages %s failed: %s", self.account_id, conv_id, exc)
                continue

            last_seen = self._cursors.get(conv_id, "")
            # messages are DESC (newest first)
            incoming: list[dict[str, Any]] = []
            newest_id = last_seen
            for msg in messages:
                mid = str(msg.get("id") or "")
                if not mid:
                    continue
                if not newest_id:
                    newest_id = mid
                if mid == last_seen:
                    break
                if is_new and last_seen == "":
                    sent = _parse_sent_at(msg.get("sent_at"))
                    if sent is not None:
                        age = (now - sent.astimezone(timezone.utc)).total_seconds()
                        if age > FIRST_SYNC_LOOKBACK_SEC:
                            continue
                incoming.append(msg)

            # ingest oldest→newest
            for msg in reversed(incoming):
                payload = map_message(
                    account_id=self.account_id,
                    conversation=conv,
                    message=msg,
                )
                if not payload:
                    continue
                try:
                    api.ingest(self.account_id, payload)
                except Exception as exc:  # noqa: BLE001
                    log.warning("[%s] ingest failed: %s", self.account_id, exc)

            if messages:
                top = str(messages[0].get("id") or "")
                if top and top != last_seen:
                    self._cursors[conv_id] = top
                    dirty = True
            elif newest_id and newest_id != last_seen:
                self._cursors[conv_id] = newest_id
                dirty = True

        if dirty:
            try:
                self.persist_cursors()
            except Exception as exc:  # noqa: BLE001
                log.debug("persist cursors: %s", exc)

    def claim_and_send(self) -> None:
        if not self.client or not self.connected:
            return
        try:
            jobs = api.claim_jobs(self.account_id, limit=5)
        except Exception as exc:  # noqa: BLE001
            log.warning("[%s] claim failed: %s", self.account_id, exc)
            return
        for job in jobs:
            conv_id = (job.get("target_jid") or job.get("target_name") or "").strip()
            body = (job.get("body") or "").strip()
            job_id = job.get("id")
            if not job_id:
                continue
            if not conv_id or not body:
                api.complete_job(job_id, ok=False, error="missing conversation_id or body")
                continue
            try:
                sent = self.client.send_text(conv_id, body)
                sm = (sent.get("sent_message") or {}) if isinstance(sent, dict) else {}
                mid = str(sm.get("id") or "")
                api.complete_job(job_id, ok=True)
                if mid:
                    # advance cursor so we don't re-ingest our own send as inbound duplicate
                    # (still ingest outbound for CRM history)
                    try:
                        api.ingest(
                            self.account_id,
                            {
                                "account_id": self.account_id,
                                "chat_name": job.get("target_name") or conv_id,
                                "body": body,
                                "direction": "outbound",
                                "phone": conv_id,
                                "external_chat_id": conv_id,
                                "chat_type": "pv",
                                "external_message_id": f"divar:{mid}",
                                "sender_type": "agent",
                            },
                        )
                        self._cursors[conv_id] = mid
                        self.persist_cursors()
                    except Exception:  # noqa: BLE001
                        pass
                self.persist_cookies()
            except Exception as exc:  # noqa: BLE001
                log.warning("[%s] send failed job=%s: %s", self.account_id, job_id, exc)
                try:
                    api.complete_job(job_id, ok=False, error=str(exc)[:300])
                except Exception:  # noqa: BLE001
                    pass
            time.sleep(0.35)


def start_session(account_id: str) -> SessionHandle:
    handle = SessionHandle(account_id)
    handle.start()
    return handle
