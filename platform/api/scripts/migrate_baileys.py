"""Migrate schema for Baileys server-side WhatsApp connector.

Safe to re-run.

Usage:
  cd platform/api
  python scripts/migrate_baileys.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text

from app.database import Base, engine


def _cols(table: str) -> set[str]:
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def main() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        acc_cols = _cols("channel_accounts")
        if acc_cols:
            alters = []
            if "connector_type" not in acc_cols:
                alters.append(
                    "ALTER TABLE channel_accounts ADD COLUMN connector_type VARCHAR(40) DEFAULT 'extension'"
                )
            if "pairing_state" not in acc_cols:
                alters.append(
                    "ALTER TABLE channel_accounts ADD COLUMN pairing_state VARCHAR(40) DEFAULT 'disconnected'"
                )
            if "wa_jid" not in acc_cols:
                alters.append(
                    "ALTER TABLE channel_accounts ADD COLUMN wa_jid VARCHAR(120) DEFAULT ''"
                )
            if "qr_payload" not in acc_cols:
                alters.append(
                    "ALTER TABLE channel_accounts ADD COLUMN qr_payload TEXT DEFAULT ''"
                )
            for sql in alters:
                conn.execute(text(sql))
                print(sql)

        job_cols = _cols("outbound_jobs")
        if job_cols and "target_jid" not in job_cols:
            sql = "ALTER TABLE outbound_jobs ADD COLUMN target_jid VARCHAR(200) DEFAULT ''"
            conn.execute(text(sql))
            print(sql)

        msg_cols = _cols("messages")
        if msg_cols:
            alters = []
            if "media_type" not in msg_cols:
                alters.append(
                    "ALTER TABLE messages ADD COLUMN media_type VARCHAR(40) DEFAULT ''"
                )
            if "media_url" not in msg_cols:
                alters.append("ALTER TABLE messages ADD COLUMN media_url TEXT DEFAULT ''")
            for sql in alters:
                conn.execute(text(sql))
                print(sql)

        tables = inspect(engine).get_table_names()
        if "wa_auth_states" not in tables:
            print("wa_auth_states created via metadata.create_all")

    print("migrate_baileys: done")


if __name__ == "__main__":
    main()
