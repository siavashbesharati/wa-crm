"""Backfill CRM semantic index for آقای میوژن.

Usage:
  cd platform/api
  python scripts/reindex_crm.py
  python scripts/reindex_crm.py --org-id <uuid>
  python scripts/reindex_crm.py --all
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import Organization  # noqa: E402
from app.services.crm_index import reindex_org  # noqa: E402


def main() -> None:
    Base.metadata.create_all(bind=engine)
    try:
        from app.main import _ensure_db_columns, _ensure_pgvector

        _ensure_db_columns()
        _ensure_pgvector()
    except Exception as exc:  # noqa: BLE001
        print("column/pgvector migrate skipped:", exc)

    args = sys.argv[1:]
    org_id = ""
    do_all = "--all" in args
    use_openai = "--openai" in args
    if "--org-id" in args:
        i = args.index("--org-id")
        if i + 1 < len(args):
            org_id = args[i + 1].strip()

    db = SessionLocal()
    try:
        if org_id:
            orgs = db.query(Organization).filter(Organization.id == org_id).all()
        elif do_all:
            orgs = db.query(Organization).all()
        else:
            # Default: demo org if present, else all
            from app.config import get_settings

            name = get_settings().demo_org_name
            orgs = db.query(Organization).filter(Organization.name == name).all()
            if not orgs:
                orgs = db.query(Organization).limit(20).all()

        if not orgs:
            print("No organizations found.")
            return

        for org in orgs:
            print(f"Reindexing org={org.id} name={org.name!r} ...")
            stats = reindex_org(db, org.id, prefer_local=not use_openai)
            print(f"  done: {stats}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
