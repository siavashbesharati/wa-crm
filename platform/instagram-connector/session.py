"""Instagram realtime session: login by session id, listen, send, reconnect."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from api_client import api
from config import HEARTBEAT_SEC, POLL_OUTBOUND_SEC, RATE_LIMIT_COOLDOWN_SEC, RECONNECT_BACKOFF
from mapper import (
    AuthRequired,
    RateLimited,
    display_name,
    is_auth_failure,
    is_rate_limited,
    map_realtime_dm,
    parse_thread_target,
)

log = logging.getLogger("instagram-connector.session")


class SessionHandle:
    def __init__(self, account_id: str):
        self.account_id = account_id
        self.connected = False
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._seen_items: set[str] = set()
        self._me_id: int | str | None = None
        self._username = ""
        self._peer_names: dict[int, str] = {}
        self._client: Any = None

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        if self._task and not self._task.done():
            return
        self._stop = asyncio.Event()
        self._task = loop.create_task(self._run(), name=f"instagram-session-{self.account_id}")

    async def stop(self) -> None:
        self._stop.set()
        self.connected = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None

    async def _run(self) -> None:
        attempt = 0
        while not self._stop.is_set():
            try:
                await self._connect_and_listen()
                attempt = 0
            except RateLimited:
                # Instagram throttled us — back off for a fixed cooldown, then retry.
                log.warning(
                    "[Instagram] Rate limited account=%s — cooling down %ss",
                    self.account_id,
                    RATE_LIMIT_COOLDOWN_SEC,
                )
                try:
                    api.put_pair_state(
                        self.account_id,
                        pairing_state="reconnecting",
                        status="offline",
                    )
                except Exception:  # noqa: BLE001
                    pass
                attempt = 0
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=RATE_LIMIT_COOLDOWN_SEC)
                except asyncio.TimeoutError:
                    continue
                return
            except AuthRequired:
                log.warning("[Instagram] Invalid/expired session account=%s — auth required", self.account_id)
                try:
                    api.put_pair_state(
                        self.account_id,
                        pairing_state="auth_required",
                        status="offline",
                    )
                except Exception:  # noqa: BLE001
                    pass
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                if is_auth_failure(exc):
                    log.warning(
                        "[Instagram] Session rejected account=%s (%s)",
                        self.account_id,
                        type(exc).__name__,
                    )
                    try:
                        api.put_pair_state(
                            self.account_id,
                            pairing_state="auth_required",
                            status="offline",
                        )
                    except Exception:  # noqa: BLE001
                        pass
                    return
                delay = RECONNECT_BACKOFF[min(attempt, len(RECONNECT_BACKOFF) - 1)]
                attempt += 1
                log.warning(
                    "[Instagram] Disconnected account=%s — reconnecting in %ss (%s)",
                    self.account_id,
                    delay,
                    type(exc).__name__,
                )
                try:
                    api.put_pair_state(
                        self.account_id,
                        pairing_state="reconnecting" if attempt < len(RECONNECT_BACKOFF) else "error",
                        status="offline",
                    )
                except Exception:  # noqa: BLE001
                    pass
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    continue
                return

    async def _connect_and_listen(self) -> None:
        import json as _json

        from aiograpi import Client

        auth = api.get_auth(self.account_id)
        session_id = (auth.get("session_id") or "").strip()
        if not session_id:
            raise AuthRequired("no stored session")

        self._username = (auth.get("username") or "").strip()
        self._me_id = auth.get("user_id") or None

        client = Client()
        self._client = client

        # Restore saved device/cookie settings so Instagram sees the same
        # device fingerprint as previous logins (fewer challenges, less 429).
        saved_settings_json = (auth.get("client_settings_json") or "").strip()
        if saved_settings_json:
            try:
                client.set_settings(_json.loads(saved_settings_json))
                log.info("[Instagram] Restored client settings account=%s", self.account_id)
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "[Instagram] Could not restore client settings account=%s (%s)",
                    self.account_id,
                    type(exc).__name__,
                )

        log.info("[Instagram] Authenticating account=%s", self.account_id)
        try:
            await client.login_by_sessionid(session_id)
        except Exception as exc:  # noqa: BLE001
            if is_rate_limited(exc):
                raise RateLimited(str(exc)) from exc
            raise
        self._me_id = getattr(client, "user_id", None) or self._me_id
        if not self._username:
            self._username = str(getattr(client, "username", "") or "")

        # Persist updated client settings for the next reconnect.
        try:
            api.put_auth_settings(self.account_id, client.get_settings())
            log.info("[Instagram] Saved client settings account=%s", self.account_id)
        except Exception as exc:  # noqa: BLE001
            log.debug("save client settings: %s", type(exc).__name__)

        log.info(
            "[Instagram] Authenticated %s user=%s account=%s",
            display_name(self._username, self._me_id),
            self._me_id,
            self.account_id,
        )

        log.info("[Instagram] Realtime connecting account=%s", self.account_id)
        try:
            await client.realtime_connect()
        except Exception as exc:  # noqa: BLE001
            if is_rate_limited(exc):
                raise RateLimited(str(exc)) from exc
            raise
        log.info("[Instagram] Realtime connected account=%s", self.account_id)

        # Handlers must be registered AFTER realtime_connect() in this aiograpi version.
        client.realtime_on("message", self._on_message)
        client.realtime_on("direct_realtime_event", self._on_direct_event)

        self.connected = True
        try:
            api.put_pair_state(
                self.account_id,
                pairing_state="connected",
                status="online",
                external_id=str(self._me_id or ""),
                label=display_name(self._username, self._me_id),
            )
            api.heartbeat(self.account_id)
        except Exception as exc:  # noqa: BLE001
            log.debug("pair-state/heartbeat: %s", exc)

        state = await client.realtime.direct_subscribe(amount=1)
        log.info("[Instagram] Direct subscription active account=%s", self.account_id)
        del state

        outbound = asyncio.create_task(self._outbound_loop(client), name=f"instagram-out-{self.account_id}")
        heartbeat = asyncio.create_task(self._heartbeat_loop(), name=f"instagram-hb-{self.account_id}")
        try:
            while not self._stop.is_set():
                try:
                    await client.realtime_read_once()
                except TimeoutError:
                    continue
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    if is_auth_failure(exc):
                        raise AuthRequired(str(exc)) from exc
                    log.warning(
                        "[Instagram] Realtime error account=%s — retrying (%s)",
                        self.account_id,
                        type(exc).__name__,
                    )
                    await asyncio.sleep(2)
        finally:
            outbound.cancel()
            heartbeat.cancel()
            self.connected = False
            try:
                await client.realtime_disconnect()
            except Exception:  # noqa: BLE001
                pass
            log.info("[Instagram] Disconnected account=%s", self.account_id)

    def _on_message(self, event: Any) -> None:
        """aiograpi dispatches 'message' events with {message: {...}} payload."""
        if isinstance(event, dict):
            message = event.get("message")
            if isinstance(message, dict):
                self._spawn_handle(message)

    def _on_direct_event(self, event: Any) -> None:
        """aiograpi dispatches 'direct_realtime_event' with thread/path + value payload."""
        if not isinstance(event, dict):
            return
        value = event.get("value")
        if not isinstance(value, dict):
            return
        message = dict(value)
        if event.get("thread_id"):
            message["thread_id"] = event["thread_id"]
        elif event.get("path"):
            message["path"] = event["path"]
        self._spawn_handle(message)

    def _spawn_handle(self, message: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._handle_dm(message))

    async def _resolve_peer_name(self, client: Any, uid: int) -> str:
        cached = self._peer_names.get(uid)
        if cached is not None:
            return cached
        username = ""
        try:
            info = await client.user_info(uid)
            username = str(getattr(info, "username", "") or "")
        except Exception:  # noqa: BLE001
            username = ""
        self._peer_names[uid] = username
        return username

    async def _handle_dm(self, message: dict[str, Any]) -> None:
        item_id = str(message.get("item_id") or message.get("message_id") or "").strip()
        if item_id:
            if item_id in self._seen_items:
                return
            self._seen_items.add(item_id)
            if len(self._seen_items) > 5000:
                keep = sorted(self._seen_items)[-2000:]
                self._seen_items = set(keep)

        payload = map_realtime_dm(
            account_id=self.account_id,
            message=message,
            me_id=self._me_id,
            username=self._username,
        )
        if not payload:
            return

        # Best-effort peer @username for CRM display (cached per session).
        sender_raw = message.get("user_id")
        try:
            sender_uid = int(sender_raw)
        except (TypeError, ValueError):
            sender_uid = 0
        if sender_uid and sender_uid not in self._peer_names and self._client is not None:
            username = await self._resolve_peer_name(self._client, sender_uid)
            if username:
                payload["chat_name"] = display_name(username, sender_uid)

        log.info(
            "[Instagram] Message received account=%s thread=%s",
            self.account_id,
            payload["external_chat_id"],
        )
        try:
            api.ingest(self.account_id, payload)
        except Exception as exc:  # noqa: BLE001
            log.warning("[Instagram] ingest failed: %s", type(exc).__name__)

    async def _heartbeat_loop(self) -> None:
        while not self._stop.is_set() and self.connected:
            try:
                api.heartbeat(self.account_id)
            except Exception:  # noqa: BLE001
                pass
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=HEARTBEAT_SEC)
            except asyncio.TimeoutError:
                continue

    async def _outbound_loop(self, client: Any) -> None:
        while not self._stop.is_set() and self.connected:
            try:
                await self._claim_and_send(client)
            except Exception as exc:  # noqa: BLE001
                log.warning("[Instagram] outbound %s: %s", self.account_id, type(exc).__name__)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=POLL_OUTBOUND_SEC)
            except asyncio.TimeoutError:
                continue

    async def _claim_and_send(self, client: Any) -> None:
        try:
            jobs = await asyncio.to_thread(api.claim_jobs, self.account_id, 5)
        except Exception as exc:  # noqa: BLE001
            log.warning("[Instagram] claim failed: %s", type(exc).__name__)
            return
        for job in jobs:
            if self._stop.is_set():
                return
            job_id = job.get("id")
            body = (job.get("body") or "").strip()
            target = (job.get("target_jid") or job.get("target_name") or "").strip()
            if not job_id:
                continue
            thread_id = parse_thread_target(target)
            if thread_id is None or not body:
                api.complete_job(job_id, ok=False, error="missing instagram thread target or body")
                continue
            try:
                await client.direct_send(body, thread_ids=[thread_id])
                api.complete_job(job_id, ok=True)
                log.info("[Instagram] Message sent account=%s thread=%s", self.account_id, thread_id)
            except AuthRequired:
                raise
            except Exception as exc:  # noqa: BLE001
                if is_auth_failure(exc):
                    log.warning("[Instagram] send rejected (auth) job=%s", job_id)
                    api.complete_job(job_id, ok=False, error="auth failure")
                    raise AuthRequired(str(exc)) from exc
                log.warning("[Instagram] send failed job=%s: %s", job_id, type(exc).__name__)
                try:
                    api.complete_job(job_id, ok=False, error=type(exc).__name__)
                except Exception:  # noqa: BLE001
                    pass


def start_session(account_id: str, loop: asyncio.AbstractEventLoop) -> SessionHandle:
    handle = SessionHandle(account_id)
    handle.start(loop)
    return handle
