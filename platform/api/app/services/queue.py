from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger("queue")


class MemoryQueue:
    def __init__(self) -> None:
        self._items: dict[str, list[str]] = {}
        self._lock = threading.Lock()

    def push(self, name: str, payload: dict) -> None:
        with self._lock:
            self._items.setdefault(name, []).append(json.dumps(payload))

    def pop(self, name: str) -> dict | None:
        with self._lock:
            items = self._items.get(name) or []
            if not items:
                return None
            return json.loads(items.pop(0))


class FileQueue:
    """Shared across API + worker processes when Redis is unavailable."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, name: str) -> Path:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in name)
        return self.root / f"{safe}.jsonl"

    def push(self, name: str, payload: dict) -> None:
        line = json.dumps(payload, ensure_ascii=False)
        with self._lock:
            with self._path(name).open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    def pop(self, name: str) -> dict | None:
        path = self._path(name)
        with self._lock:
            if not path.exists():
                return None
            lines = path.read_text(encoding="utf-8").splitlines()
            if not lines:
                return None
            first, rest = lines[0], lines[1:]
            path.write_text("\n".join(rest) + ("\n" if rest else ""), encoding="utf-8")
            try:
                return json.loads(first)
            except json.JSONDecodeError:
                return None


_memory = MemoryQueue()
_file: FileQueue | None = None
_redis = None


def _file_queue() -> FileQueue:
    global _file
    if _file is None:
        # Next to SQLite DB by default
        root = Path(__file__).resolve().parents[2] / "data" / "queues"
        _file = FileQueue(root)
    return _file


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
        logger.warning("Redis unavailable, using file queue: %s", exc)
        _redis = False
        return None


def redis_available() -> bool:
    return _client() is not None and _redis is not False


def enqueue(name: str, payload: dict) -> None:
    client = _client()
    if client:
        client.lpush(name, json.dumps(payload))
    else:
        _file_queue().push(name, payload)


def dequeue(name: str) -> dict | None:
    client = _client()
    if client:
        raw = client.rpop(name)
        return json.loads(raw) if raw else None
    return _file_queue().pop(name)
