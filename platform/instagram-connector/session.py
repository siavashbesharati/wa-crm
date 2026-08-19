from __future__ import annotations

import json
import logging
import time
from typing import Any

from adapter import InstagramAdapter
from api_client import BidarApi
from config import COMMENT_LIMIT, MEDIA_LIMIT, MESSAGE_LIMIT, POLL_SECONDS, THREAD_LIMIT
from mapper import comment_event, dm_event, value

log = logging.getLogger("instagram-connector.session")


class SessionHandle:
    def __init__(self, account: dict[str, Any], api: BidarApi) -> None:
        self.account = account
        self.account_id = str(account["id"])
        self.api = api
        self.adapter: InstagramAdapter | None = None
        self.me_id = ""

    def run_once(self) -> None:
        state = self.api.settings(self.account_id)
        settings = json.loads(state.get("settings_json") or "{}")
        self.adapter = InstagramAdapter(settings=settings)
        credentials = json.loads(state.get("credentials_json") or "{}")
        pending = json.loads(state.get("pending_json") or "{}")
        username = str(credentials.get("username") or pending.get("username") or self.account.get("external_id") or "")
        password = str(credentials.get("password") or pending.get("password") or "")
        verification_code = str(pending.get("verification_code") or "")
        if not settings and not username:
            self.api.state(self.account_id, pairing_state="auth_required", status="offline")
            return
        try:
            if username and password:
                self.adapter.login(username, password, verification_code=verification_code)
            profile = self.adapter.profile()
            profile_data = self.adapter.serialize(profile)
            self.me_id = str(profile_data.get("pk") or profile_data.get("user_id") or "")
            self.api.state(
                self.account_id,
                settings_json=self.adapter.dump_settings_json(),
                credentials_json=json.dumps({"username": username, "password": password}),
                pending_json="",
                profile=profile_data,
                pairing_state="connected",
                status="online",
            )
            self.api.heartbeat(self.account_id)
            self.sync_dms()
            self.sync_comments(profile_data)
            self.sync_outbound()
        except Exception as exc:  # noqa: BLE001
            name = type(exc).__name__
            state_name = "challenge_required" if "Challenge" in name else "two_factor_required" if "TwoFactor" in name else "reconnecting"
            log.warning("Instagram account %s failed: %s", self.account_id, name)
            self.api.state(self.account_id, pairing_state=state_name, status="offline", pending_json=json.dumps({"message": str(exc)[:240]}))

    def sync_outbound(self) -> None:
        assert self.adapter is not None
        for job in self.api.claim_jobs(self.account_id, limit=5):
            target = str(job.get("target_jid") or job.get("target_name") or "")
            try:
                if target.startswith("instagram:comment:"):
                    parts = target.split(":", 3)
                    if len(parts) != 4:
                        raise ValueError("invalid Instagram comment target")
                    media_id = parts[2]
                    comment_id = parts[3].removeprefix("comment:")
                    sent = self.adapter.reply_to_comment(
                        media_id,
                        str(job.get("body") or ""),
                        int(comment_id),
                    )
                else:
                    sent = self.adapter.send_text(target, str(job.get("body") or ""))
                self.api.complete_job(job["id"], ok=bool(sent))
            except Exception as exc:  # noqa: BLE001
                self.api.complete_job(job["id"], ok=False, error=str(exc))

    def sync_dms(self) -> None:
        assert self.adapter is not None
        for thread in self.adapter.direct_threads(amount=THREAD_LIMIT):
            thread_id = str(value(thread, "id", "") or value(thread, "thread_id", ""))
            if not thread_id:
                continue
            for message in self.adapter.direct_messages(int(thread_id), amount=MESSAGE_LIMIT):
                if str(value(message, "user_id", "") or "") == self.me_id:
                    continue
                payload = dm_event(thread, message)
                if payload["body"]:
                    self.api.event(self.account_id, payload)

    def sync_comments(self, profile: dict[str, Any]) -> None:
        assert self.adapter is not None
        owner_id = str(profile.get("pk") or profile.get("user_id") or self.me_id)
        if not owner_id:
            return
        for media in self.adapter.user_medias(owner_id, amount=MEDIA_LIMIT):
            media_id = str(value(media, "pk", "") or value(media, "id", ""))
            if not media_id:
                continue
            for comment in self.adapter.media_comments(media_id, amount=COMMENT_LIMIT):
                payload = comment_event(media_id, comment)
                if payload["body"]:
                    self.api.event(self.account_id, payload)

    def run_forever(self) -> None:
        while True:
            self.run_once()
            time.sleep(POLL_SECONDS)
