from __future__ import annotations

import json
import logging

from app.config import get_settings

logger = logging.getLogger("queue")


class MemoryQueue:
    def __init__(self) -> None:
        self._items: dict[str, list[str]] = {}

    def push(self, name: str, payload: dict) -> None:
        self._items.setdefault(name, []).append(json.dumps(payload))

    def pop(self, name: str) -> dict | None:
        items = self._items.get(name) or []
        if not items:
            return None
        return json.loads(items.pop(0))


_memory = MemoryQueue()
_redis = None


def _client():
    global _redis
    if _redis is not None:
        return _redis
    try:
        import redis

        client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True)
        client.ping()
        _redis = client
        return _redis
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis unavailable, using memory queue: %s", exc)
        _redis = False
        return None


def enqueue(name: str, payload: dict) -> None:
    client = _client()
    if client:
        client.lpush(name, json.dumps(payload))
    else:
        _memory.push(name, payload)


def dequeue(name: str) -> dict | None:
    client = _client()
    if client:
        raw = client.rpop(name)
        return json.loads(raw) if raw else None
    return _memory.pop(name)
