"""Dedicated multi-tenant Instagram polling connector."""

from __future__ import annotations

import logging
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from api_client import BidarApi
from config import POLL_SECONDS
from session import SessionHandle
from app.services.seq_logging import configure_seq_logging


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [instagram] %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("instagram-connector")
configure_seq_logging("instagram")


def main() -> None:
    api = BidarApi()
    workers: dict[str, threading.Thread] = {}
    try:
        while True:
            for account in api.sessions():
                account_id = str(account.get("id") or "")
                if not account_id or account_id in workers:
                    continue
                handle = SessionHandle(account, api)
                thread = threading.Thread(
                    target=handle.run_forever,
                    name=f"instagram-{account_id}",
                    daemon=True,
                )
                workers[account_id] = thread
                thread.start()
            time.sleep(POLL_SECONDS)
    finally:
        api.close()


if __name__ == "__main__":
    main()
