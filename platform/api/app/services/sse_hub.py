"""In-process SSE hub: push job_ready (and similar) to connected extensions.

Works with a single uvicorn worker. For multi-worker deploy, replace with Redis pub/sub.
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any


class SseHub:
    def __init__(self) -> None:
        self._subs: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        self._loop = loop or asyncio.get_running_loop()

    async def subscribe(self, account_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subs[account_id].append(q)
        if self._loop is None:
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                pass
        return q

    async def unsubscribe(self, account_id: str, q: asyncio.Queue) -> None:
        subs = self._subs.get(account_id) or []
        if q in subs:
            subs.remove(q)
        if not subs and account_id in self._subs:
            del self._subs[account_id]

    def subscriber_count(self, account_id: str = "") -> int:
        if account_id:
            return len(self._subs.get(account_id) or [])
        return sum(len(v) for v in self._subs.values())

    def publish(self, account_id: str, event: str, data: dict[str, Any] | None = None) -> int:
        """Thread-safe-ish publish from sync routes / workers. Returns notified queues."""
        aid = (account_id or "").strip()
        if not aid:
            return 0
        payload = {"event": event, "data": data or {}}
        subs = list(self._subs.get(aid) or [])
        if not subs:
            return 0
        loop = self._loop
        notified = 0
        for q in subs:
            try:
                if loop is not None and loop.is_running():
                    loop.call_soon_threadsafe(self._put, q, payload)
                else:
                    self._put(q, payload)
                notified += 1
            except Exception:  # noqa: BLE001
                continue
        return notified

    @staticmethod
    def _put(q: asyncio.Queue, payload: dict) -> None:
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            try:
                q.get_nowait()
            except Exception:  # noqa: BLE001
                pass
            try:
                q.put_nowait(payload)
            except Exception:  # noqa: BLE001
                pass


def format_sse(event: str, data: dict[str, Any] | None = None, event_id: str = "") -> str:
    body = json.dumps(data or {}, ensure_ascii=False, separators=(",", ":"))
    lines = []
    if event_id:
        lines.append(f"id: {event_id}")
    if event:
        lines.append(f"event: {event}")
    lines.append(f"data: {body}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


sse_hub = SseHub()


def publish_job_ready(
    account_id: str,
    *,
    job_id: str = "",
    reason: str = "",
    org_id: str = "",
) -> int:
    payload = {
        "account_id": account_id,
        "job_id": job_id or "",
        "reason": reason or "",
        "org_id": org_id or "",
    }
    n = sse_hub.publish(account_id, "job_ready", payload)
    if org_id:
        n += sse_hub.publish(f"org:{org_id}", "job_ready", payload)
    return n


def publish_org_event(org_id: str, event: str, data: dict[str, Any] | None = None) -> int:
    oid = (org_id or "").strip()
    if not oid:
        return 0
    return sse_hub.publish(f"org:{oid}", event, data or {})
