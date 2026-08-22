from __future__ import annotations

import os
from pathlib import Path

_API_DIR = Path(__file__).resolve().parents[1] / "api"
_KEY_FILE = _API_DIR / ".local" / "instagram_connector_key"


def _load_key() -> str:
    env = (os.environ.get("INSTAGRAM_CONNECTOR_KEY") or "").strip()
    if env:
        return env
    try:
        if _KEY_FILE.is_file():
            return _KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        pass
    return "dev-instagram-connector-key-change-me"


API_BASE = (os.environ.get("CRM_API_BASE") or "http://127.0.0.1:8000/api").rstrip("/")
CONNECTOR_KEY = _load_key()
HEALTH_PORT = int(os.environ.get("INSTAGRAM_CONNECTOR_PORT") or "8093")
POLL_SESSIONS_SEC = float(os.environ.get("INSTAGRAM_POLL_SESSIONS") or "8")
POLL_OUTBOUND_SEC = float(os.environ.get("INSTAGRAM_POLL_OUTBOUND") or "3")
HEARTBEAT_SEC = float(os.environ.get("INSTAGRAM_HEARTBEAT_SEC") or "20")
FORCE_ACCOUNT_ID = (os.environ.get("INSTAGRAM_FORCE_ACCOUNT_ID") or "").strip()
RECONNECT_BACKOFF = (2, 5, 10, 30, 60)
RATE_LIMIT_COOLDOWN_SEC = float(os.environ.get("INSTAGRAM_RATE_LIMIT_COOLDOWN") or "1200")
