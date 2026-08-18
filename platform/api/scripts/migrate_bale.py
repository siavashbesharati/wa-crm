"""Ensure Bale server-connector tables exist (SQLite-friendly).

Usage:
  cd platform/api
  python scripts/migrate_bale.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect

from app.database import Base, engine
from app.models import BaleAuthState  # noqa: F401


def main() -> None:
    Base.metadata.create_all(bind=engine)
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    print("bale_auth_states" in tables and "ok: bale_auth_states" or "missing bale_auth_states")
    if "channel_accounts" in tables:
        cols = {c["name"] for c in insp.get_columns("channel_accounts")}
        print("connector_type column:", "connector_type" in cols)


if __name__ == "__main__":
    main()
