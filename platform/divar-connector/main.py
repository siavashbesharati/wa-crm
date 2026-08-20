"""Divar HTTP connector sidecar — poll chat APIs, ingest, send outbound jobs."""

from __future__ import annotations

import logging
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from api_client import api
from config import (
    FORCE_ACCOUNT_ID,
    HEALTH_PORT,
    POLL_INBOUND_SEC,
    POLL_OUTBOUND_SEC,
    POLL_SESSIONS_SEC,
)
from session import SessionHandle, start_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [divar] %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("divar-connector")

sessions: dict[str, SessionHandle] = {}
_last_pair: dict[str, str] = {}


def ensure_session(info: dict) -> None:
    account_id = info["id"]
    if account_id in sessions:
        h = sessions[account_id]
        if not h.connected and (info.get("pairing_state") or "") == "connected":
            h.start()
        return
    state = (info.get("pairing_state") or "").lower()
    if state == "disconnected":
        return
    if state in ("connected", "otp_pending"):
        # otp_pending: wait until cookies exist (after code)
        if state == "otp_pending":
            return
        log.info("starting session %s", account_id)
        sessions[account_id] = start_session(account_id)


def stop_session(account_id: str) -> None:
    h = sessions.pop(account_id, None)
    if h:
        h.stop()
        log.info("stopped session %s", account_id)
    _last_pair.pop(account_id, None)


def sync_sessions() -> None:
    try:
        lst = api.list_sessions()
    except Exception as exc:  # noqa: BLE001
        log.warning("listSessions failed: %s", exc)
        return
    if FORCE_ACCOUNT_ID:
        lst = [s for s in lst if s.get("id") == FORCE_ACCOUNT_ID]
    wanted = {s["id"] for s in lst}
    for aid in list(sessions.keys()):
        if aid not in wanted:
            stop_session(aid)
    for info in lst:
        state = (info.get("pairing_state") or "").lower()
        prev = _last_pair.get(info["id"])
        _last_pair[info["id"]] = state
        if prev and prev != "disconnected" and state == "disconnected":
            stop_session(info["id"])
            continue
        if state == "connected":
            ensure_session(info)


def tick_inbound() -> None:
    for h in list(sessions.values()):
        if h.connected:
            try:
                h.sync_inbound()
            except Exception as exc:  # noqa: BLE001
                log.warning("inbound %s: %s", h.account_id, exc)


def tick_outbound() -> None:
    for h in list(sessions.values()):
        if h.connected:
            try:
                api.heartbeat(h.account_id)
            except Exception:  # noqa: BLE001
                pass
            try:
                h.claim_and_send()
            except Exception as exc:  # noqa: BLE001
                log.warning("outbound %s: %s", h.account_id, exc)


class HealthHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/health"):
            import json as _json

            body = _json.dumps(
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


def main() -> None:
    start_health()
    last_sess = 0.0
    last_in = 0.0
    last_out = 0.0
    log.info("divar-connector started")
    while True:
        now = time.time()
        if now - last_sess >= POLL_SESSIONS_SEC:
            sync_sessions()
            last_sess = now
        if now - last_in >= POLL_INBOUND_SEC:
            tick_inbound()
            last_in = now
        if now - last_out >= POLL_OUTBOUND_SEC:
            tick_outbound()
            last_out = now
        time.sleep(0.4)


if __name__ == "__main__":
    main()
