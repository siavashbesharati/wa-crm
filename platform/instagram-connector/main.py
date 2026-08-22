"""Instagram realtime connector sidecar — restore sessions, listen, send outbound jobs."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from api_client import api
from config import FORCE_ACCOUNT_ID, HEALTH_PORT, POLL_SESSIONS_SEC
from session import SessionHandle, start_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("instagram-connector")

sessions: dict[str, SessionHandle] = {}
_last_pair: dict[str, str] = {}
_loop: asyncio.AbstractEventLoop | None = None


def _loop_or_raise() -> asyncio.AbstractEventLoop:
    if _loop is None:
        raise RuntimeError("event loop not started")
    return _loop


async def ensure_session(info: dict) -> None:
    account_id = info["id"]
    state = (info.get("pairing_state") or "").lower()
    if account_id in sessions:
        h = sessions[account_id]
        if not h.connected and state == "connected":
            h.start(_loop_or_raise())
        return
    if state in ("disconnected", "auth_required"):
        return
    if state in ("connected", "reconnecting", "connecting"):
        log.info("[Instagram] Session restore account=%s", account_id)
        sessions[account_id] = start_session(account_id, _loop_or_raise())


async def stop_session(account_id: str) -> None:
    h = sessions.pop(account_id, None)
    if h:
        await h.stop()
        log.info("[Instagram] stopped session %s", account_id)
    _last_pair.pop(account_id, None)


async def sync_sessions() -> None:
    try:
        lst = await asyncio.to_thread(api.list_sessions)
    except Exception as exc:  # noqa: BLE001
        log.warning("listSessions failed: %s", type(exc).__name__)
        return
    if FORCE_ACCOUNT_ID:
        lst = [s for s in lst if s.get("id") == FORCE_ACCOUNT_ID]
    wanted = {s["id"] for s in lst}
    for aid in list(sessions.keys()):
        if aid not in wanted:
            await stop_session(aid)
    for info in lst:
        state = (info.get("pairing_state") or "").lower()
        prev = _last_pair.get(info["id"])
        _last_pair[info["id"]] = state
        if prev and prev not in ("disconnected", "auth_required") and state in (
            "disconnected",
            "auth_required",
        ):
            await stop_session(info["id"])
            continue
        if state in ("connected", "reconnecting", "connecting"):
            await ensure_session(info)


class HealthHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/health"):
            body = json.dumps(
                {
                    "ok": True,
                    "sessions": list(sessions.keys()),
                    "connected": [h.account_id for h in sessions.values() if h.connected],
                }
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()


def start_health() -> None:
    server = HTTPServer(("127.0.0.1", HEALTH_PORT), HealthHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    log.info("health on http://127.0.0.1:%s/health", HEALTH_PORT)


async def supervisor() -> None:
    log.info("instagram-connector started")
    while True:
        await sync_sessions()
        await asyncio.sleep(POLL_SESSIONS_SEC)


def main() -> None:
    global _loop
    start_health()
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    try:
        _loop.run_until_complete(supervisor())
    except KeyboardInterrupt:
        log.info("shutting down")
    finally:
        for aid in list(sessions.keys()):
            try:
                _loop.run_until_complete(stop_session(aid))
            except Exception:  # noqa: BLE001
                pass
        _loop.close()


if __name__ == "__main__":
    main()
