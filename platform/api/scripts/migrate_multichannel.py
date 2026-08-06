"""Migrate local SQLite from WhatsApp-only schema to multi-channel.

Safe to re-run. For a clean demo you can also delete wa_crm.db and run seed_demo.py
(stop the API process first).

Usage:
  cd platform/api
  python scripts/migrate_multichannel.py
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
        # Ensure channel_accounts exists and is seeded from legacy whatsapp_accounts
        tables = inspect(engine).get_table_names()
        if "channel_accounts" in tables and "whatsapp_accounts" in tables:
            count = conn.execute(text("SELECT COUNT(*) FROM channel_accounts")).scalar() or 0
            if count == 0:
                wa_cols = _cols("whatsapp_accounts")
                if "phone" in wa_cols:
                    conn.execute(
                        text(
                            """
                            INSERT INTO channel_accounts (id, org_id, channel, label, external_id, status, created_at)
                            SELECT id, org_id, 'whatsapp', label, phone, status, created_at
                            FROM whatsapp_accounts
                            """
                        )
                    )
                    print("Copied whatsapp_accounts → channel_accounts")

        lead_cols = _cols("leads")
        if lead_cols:
            alters = []
            if "external_chat_id" not in lead_cols:
                alters.append("ALTER TABLE leads ADD COLUMN external_chat_id VARCHAR(120)")
            if "post_token" not in lead_cols:
                alters.append("ALTER TABLE leads ADD COLUMN post_token VARCHAR(120) DEFAULT ''")
            if "source_channel" not in lead_cols:
                alters.append("ALTER TABLE leads ADD COLUMN source_channel VARCHAR(40) DEFAULT ''")
            for sql in alters:
                conn.execute(text(sql))
                print(sql)

        link_cols = _cols("lead_account_links")
        if link_cols and "external_chat_id" not in link_cols:
            conn.execute(text("ALTER TABLE lead_account_links ADD COLUMN external_chat_id VARCHAR(120)"))
            print("ALTER TABLE lead_account_links ADD COLUMN external_chat_id")

        acc_cols = _cols("channel_accounts")
        if acc_cols:
            if "channel" not in acc_cols:
                conn.execute(text("ALTER TABLE channel_accounts ADD COLUMN channel VARCHAR(40) DEFAULT 'whatsapp'"))
                print("ALTER TABLE channel_accounts ADD COLUMN channel")
            if "external_id" not in acc_cols:
                conn.execute(text("ALTER TABLE channel_accounts ADD COLUMN external_id VARCHAR(120) DEFAULT ''"))
                print("ALTER TABLE channel_accounts ADD COLUMN external_id")
                if "phone" in acc_cols:
                    conn.execute(text("UPDATE channel_accounts SET external_id = COALESCE(phone, '')"))

        # Dual-dashboard: platform super-admin + org status
        user_cols = _cols("users")
        if user_cols and "is_platform_admin" not in user_cols:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN is_platform_admin BOOLEAN DEFAULT 0")
            )
            print("ALTER TABLE users ADD COLUMN is_platform_admin")

        org_cols = _cols("organizations")
        if org_cols and "status" not in org_cols:
            conn.execute(
                text("ALTER TABLE organizations ADD COLUMN status VARCHAR(40) DEFAULT 'active'")
            )
            print("ALTER TABLE organizations ADD COLUMN status")
        if org_cols and "onboarding_step" not in org_cols:
            conn.execute(
                text(
                    "ALTER TABLE organizations ADD COLUMN onboarding_step VARCHAR(40) DEFAULT 'done'"
                )
            )
            print("ALTER TABLE organizations ADD COLUMN onboarding_step")
        if org_cols and "industry" not in org_cols:
            conn.execute(
                text("ALTER TABLE organizations ADD COLUMN industry VARCHAR(120) DEFAULT ''")
            )
            print("ALTER TABLE organizations ADD COLUMN industry")
        if org_cols and "city" not in org_cols:
            conn.execute(
                text("ALTER TABLE organizations ADD COLUMN city VARCHAR(120) DEFAULT ''")
            )
            print("ALTER TABLE organizations ADD COLUMN city")

        # extension_seats created via Base.metadata.create_all
        seat_cols = _cols("extension_seats")
        if seat_cols and "token_plain" not in seat_cols:
            conn.execute(
                text("ALTER TABLE extension_seats ADD COLUMN token_plain VARCHAR(120) DEFAULT ''")
            )
            print("ALTER TABLE extension_seats ADD COLUMN token_plain")

    print("Migration done.")


if __name__ == "__main__":
    main()
