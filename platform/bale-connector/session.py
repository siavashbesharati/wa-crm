"""Persistent BaleClient session: connect, sync, listen, send, reconnect."""

from __future__ import annotations

import asyncio
import json
import logging
import random
from typing import Any

from api_client import api
from config import (
    FIRST_SYNC_DIALOGS,
    FIRST_SYNC_LIMIT,
    HEARTBEAT_SEC,
    POLL_OUTBOUND_SEC,
    RECONNECT_BACKOFF,
)
from mapper import (
    AuthRequired,
    is_auth_failure,
    map_history_message,
    map_new_message_event,
    parse_peer_key,
    parse_token_blob,
    peer_key,
    phone_from_contact_records,
)

log = logging.getLogger("bale-connector.session")


class SessionHandle:
    def __init__(self, account_id: str):
        self.account_id = account_id
        self.connected = False
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._cursors: dict[str, str] = {}
        self._me_id: int | None = None
        self._synced = False
        self._profiles: dict[str, tuple[str, str, str]] = {}

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        if self._task and not self._task.done():
            return
        self._stop = asyncio.Event()
        self._task = loop.create_task(self._run(), name=f"bale-session-{self.account_id}")

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
            except AuthRequired:
                log.warning("Invalid/expired session account=%s — auth required", self.account_id)
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
                    log.warning("Session rejected account=%s", self.account_id)
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
                    "Disconnected account=%s — reconnecting in %ss (%s)",
                    self.account_id,
                    delay,
                    type(exc).__name__,
                )
                try:
                    api.put_pair_state(
                        self.account_id,
                        pairing_state="reconnecting",
                        status="offline",
                    )
                except Exception:  # noqa: BLE001
                    pass
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    continue
                return
            if self._stop.is_set():
                return
            delay = RECONNECT_BACKOFF[min(attempt, len(RECONNECT_BACKOFF) - 1)]
            attempt += 1
            log.info("Reconnecting account=%s in %ss", self.account_id, delay)
            try:
                api.put_pair_state(
                    self.account_id,
                    pairing_state="reconnecting",
                    status="offline",
                )
            except Exception:  # noqa: BLE001
                pass
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                continue

    async def _connect_and_listen(self) -> None:
        from bale import BaleClient, events
        from bale.peer import Peer

        auth = api.get_auth(self.account_id)
        blob = parse_token_blob(auth.get("token_json") or "")
        if not blob:
            raise AuthRequired("no stored session")

        try:
            cursors = json.loads(auth.get("cursors_json") or "{}")
            if isinstance(cursors, dict):
                self._cursors = {str(k): str(v) for k, v in cursors.items()}
        except json.JSONDecodeError:
            self._cursors = {}

        token = str(blob["access_token"])
        client = BaleClient(token)
        log.info("Connecting account=%s", self.account_id)
        await client.connect()
        log.info("Connected account=%s", self.account_id)

        me = await client.get_me()
        self._me_id = int(getattr(me.peer, "id", 0) or client.me_id or blob.get("user_id") or 0)
        title = str(getattr(me, "title", "") or blob.get("user_name") or "")
        log.info("Account loaded id=%s name=%s", self._me_id, title or "—")

        self.connected = True
        try:
            api.put_pair_state(
                self.account_id,
                pairing_state="connected",
                status="online",
                external_id=str(blob.get("phone") or self._me_id or ""),
                label=title,
            )
            api.heartbeat(self.account_id)
        except Exception as exc:  # noqa: BLE001
            log.debug("pair-state/heartbeat: %s", exc)

        async def on_new_message(event) -> None:
            await self._handle_event(client, event)

        client.add_event_handler(on_new_message, events.NewMessage)
        log.info("Listening account=%s", self.account_id)

        if not self._synced:
            try:
                await self._initial_sync(client)
                self._synced = True
            except Exception as exc:  # noqa: BLE001
                log.warning("Dialog/message sync failed account=%s: %s", self.account_id, type(exc).__name__)

        outbound = asyncio.create_task(self._outbound_loop(client, Peer), name=f"bale-out-{self.account_id}")
        heartbeat = asyncio.create_task(self._heartbeat_loop(), name=f"bale-hb-{self.account_id}")
        try:
            disconnect = asyncio.create_task(client.run_until_disconnected())
            stopper = asyncio.create_task(self._stop.wait())
            done, pending = await asyncio.wait(
                {disconnect, stopper},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
            if stopper in done and not self._stop.is_set():
                pass
        finally:
            outbound.cancel()
            heartbeat.cancel()
            self.connected = False
            try:
                await client.close()
            except Exception:  # noqa: BLE001
                pass
            log.info("Disconnected account=%s", self.account_id)

    async def _resolve_profile(self, client: Any, peer: Any) -> tuple[str, str, str]:
        """Return (title, username, phone) for a Bale peer. Cached per session."""
        peer_type = int(getattr(peer, "type", 1) or 1)
        peer_id = int(getattr(peer, "id", 0) or 0)
        if not peer_id:
            return "", "", ""
        key = peer_key(peer_type, peer_id)
        cached = self._profiles.get(key)
        if cached and (cached[0] or cached[1] or cached[2]):
            return cached

        title = ""
        username = ""
        phone = ""
        try:
            title = str(client.name_of(peer_type, peer_id) or "")
        except Exception:  # noqa: BLE001
            title = ""
        try:
            if peer_type == 1:
                await client.load_users([peer_id])
            else:
                await client.load_groups([peer_id])
            title = str(client.name_of(peer_type, peer_id) or title)
        except Exception:  # noqa: BLE001
            pass

        if peer_type == 1:
            try:
                from bale import bale_pb2 as pb
                from bale.peer import Peer, _info_from_full_user

                ref = Peer.user(peer_id)
                cached_info = client.cache.by_id(1, peer_id)
                if cached_info is not None:
                    ref = cached_info.peer
                req = pb.GetFullUserRequest()
                req.peer.uid = ref.id
                req.peer.accessHash = int(getattr(ref, "access_hash", 0) or 0)
                resp = await client.call("bale.users.v1.Users", "GetFullUser", req)
                if resp is not None:
                    info = _info_from_full_user(ref, resp)
                    client.cache.put(info)
                    title = str(getattr(info, "title", None) or title or "")
                    username = str(getattr(info, "username", None) or "")
                    phone = phone_from_contact_records(list(getattr(resp.fullUser, "contactInfo", []) or []))
            except Exception as exc:  # noqa: BLE001
                log.debug("full user profile %s: %s", key, type(exc).__name__)
                try:
                    from bale.peer import Peer

                    info = await client.get_entity(Peer.user(peer_id))
                    title = str(getattr(info, "title", None) or title or "")
                    username = str(getattr(info, "username", None) or username)
                except Exception:  # noqa: BLE001
                    pass
        else:
            try:
                info = await client.get_entity(peer)
                title = str(getattr(info, "title", None) or title or "")
                username = str(getattr(info, "username", None) or "")
            except Exception:  # noqa: BLE001
                pass

        profile = (title, username, phone)
        self._profiles[key] = profile
        return profile

    async def _initial_sync(self, client: Any) -> None:
        log.info("Dialog sync started account=%s", self.account_id)
        try:
            dialogs = await client.get_dialogs(limit=FIRST_SYNC_DIALOGS)
        except Exception as exc:  # noqa: BLE001
            log.warning("get_dialogs failed: %s", type(exc).__name__)
            return

        dirty = False
        for dialog in dialogs:
            if self._stop.is_set():
                return
            peer = getattr(dialog, "peer", None)
            if peer is None:
                continue
            peer_type = int(getattr(peer, "type", 1) or 1)
            peer_id = int(getattr(peer, "id", 0) or 0)
            if not peer_id:
                continue
            key = peer_key(peer_type, peer_id)
            title, username, phone = await self._resolve_profile(client, peer)
            if not title:
                title = str(getattr(dialog, "title", None) or getattr(dialog, "name", None) or key)
            already = key in self._cursors
            try:
                messages = await client.get_messages(peer, limit=FIRST_SYNC_LIMIT)
            except Exception as exc:  # noqa: BLE001
                log.debug("history %s failed: %s", key, type(exc).__name__)
                continue

            last_seen = self._cursors.get(key, "")
            incoming: list[Any] = []
            newest = last_seen
            # get_messages yields newest first
            for msg in messages:
                rid = str(int(getattr(msg, "rid", 0) or 0))
                if not rid or rid == "0":
                    continue
                if not newest:
                    newest = rid
                if already and rid == last_seen:
                    break
                incoming.append(msg)

            for msg in reversed(incoming):
                payload = map_history_message(
                    account_id=self.account_id,
                    peer_type=peer_type,
                    peer_id=peer_id,
                    title=title,
                    entry=msg,
                    me_id=self._me_id,
                    username=username,
                    phone=phone,
                )
                if not payload:
                    continue
                try:
                    api.ingest(self.account_id, payload)
                except Exception as exc:  # noqa: BLE001
                    log.warning("ingest failed: %s", type(exc).__name__)

            # Already-synced chats: re-ingest latest so name/phone heal in CRM
            if already and not incoming and messages:
                payload = map_history_message(
                    account_id=self.account_id,
                    peer_type=peer_type,
                    peer_id=peer_id,
                    title=title,
                    entry=messages[0],
                    me_id=self._me_id,
                    username=username,
                    phone=phone,
                )
                if payload:
                    try:
                        api.ingest(self.account_id, payload)
                    except Exception as exc:  # noqa: BLE001
                        log.debug("name refresh ingest: %s", type(exc).__name__)

            if messages:
                top = str(int(getattr(messages[0], "rid", 0) or 0))
                if top and top != "0" and top != last_seen:
                    self._cursors[key] = top
                    dirty = True
            elif newest and newest != last_seen:
                self._cursors[key] = newest
                dirty = True

        if dirty:
            try:
                api.put_cursors(self.account_id, self._cursors)
            except Exception:  # noqa: BLE001
                pass
        log.info("Dialog sync completed account=%s dialogs=%s", self.account_id, len(dialogs))

    async def _handle_event(self, client: Any, event: Any) -> None:
        title = ""
        username = ""
        phone = ""
        try:
            peer = getattr(event, "peer", None)
            if peer is not None:
                title, username, phone = await self._resolve_profile(client, peer)
        except Exception:  # noqa: BLE001
            title, username, phone = "", "", ""
        payload = map_new_message_event(
            account_id=self.account_id,
            event=event,
            title=title,
            me_id=self._me_id,
            username=username,
            phone=phone,
        )
        if not payload:
            return
        log.info("Incoming message received account=%s", self.account_id)
        try:
            api.ingest(self.account_id, payload)
        except Exception as exc:  # noqa: BLE001
            log.warning("ingest failed: %s", type(exc).__name__)
            return
        ext = payload.get("external_chat_id") or ""
        mid = str(payload.get("external_message_id") or "").rsplit(":", 1)[-1]
        if ext and mid:
            self._cursors[ext] = mid
            try:
                api.put_cursors(self.account_id, self._cursors)
            except Exception:  # noqa: BLE001
                pass

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

    async def _outbound_loop(self, client: Any, peer_cls: Any) -> None:
        while not self._stop.is_set() and self.connected:
            try:
                await self._claim_and_send(client, peer_cls)
            except Exception as exc:  # noqa: BLE001
                log.warning("outbound %s: %s", self.account_id, type(exc).__name__)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=POLL_OUTBOUND_SEC)
            except asyncio.TimeoutError:
                continue

    async def _claim_and_send(self, client: Any, peer_cls: Any) -> None:
        try:
            jobs = await asyncio.to_thread(api.claim_jobs, self.account_id, 5)
        except Exception as exc:  # noqa: BLE001
            log.warning("claim failed: %s", type(exc).__name__)
            return
        for job in jobs:
            if self._stop.is_set():
                return
            job_id = job.get("id")
            body = (job.get("body") or "").strip()
            target = (job.get("target_jid") or job.get("target_name") or "").strip()
            if not job_id:
                continue
            parsed = parse_peer_key(target)
            if not parsed or not body:
                api.complete_job(job_id, ok=False, error="missing peer or body")
                continue
            kind, pid = parsed
            try:
                if kind == "user":
                    from bale.peer import Peer

                    ref = Peer.user(pid)
                    cached = client.cache.by_id(1, pid)
                    if cached is not None:
                        ref = cached.peer
                else:
                    ref = peer_cls.channel(pid)
                rid = random.getrandbits(63)
                await client.send_message(ref, body, rid=rid)
                api.complete_job(job_id, ok=True)
                log.info("Message sent account=%s", self.account_id)
                peer_type = 1 if kind == "user" else 2
                ext = peer_key(peer_type, pid)
                self._cursors[ext] = str(rid)
                try:
                    api.put_cursors(self.account_id, self._cursors)
                except Exception:  # noqa: BLE001
                    pass
            except Exception as exc:  # noqa: BLE001
                log.warning("send failed job=%s: %s", job_id, type(exc).__name__)
                try:
                    api.complete_job(job_id, ok=False, error=type(exc).__name__)
                except Exception:  # noqa: BLE001
                    pass


def start_session(account_id: str, loop: asyncio.AbstractEventLoop) -> SessionHandle:
    handle = SessionHandle(account_id)
    handle.start(loop)
    return handle
