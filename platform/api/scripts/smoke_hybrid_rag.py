"""Quick smoke test for hybrid RAG + SQL coach stack."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import CrmIndexChunk, Organization  # noqa: E402
from app.services.crm_index import reindex_org, retrieve_crm_context  # noqa: E402
from app.services.embeddings import embed_crm_text  # noqa: E402
from app.services.org_analytics import (  # noqa: E402
    analytics_for_message,
    detect_analytics_intents,
    parse_requested_limit,
)


def main() -> None:
    assert parse_requested_limit("ده تا از داغ ترین لیدها") == 10
    assert "hot_today" in detect_analytics_intents("ده تا از داغ ترین لیدها")
    assert "tasks_completed" in detect_analytics_intents(
        "کدام کارمند تسک های بیشتری انجام داده"
    )
    assert "lead_playbook" in detect_analytics_intents("پیشنهاد بر اساس گفتگو")

    v1, p1 = embed_crm_text(None, "test lead", prefer_local=True)
    assert p1 == "local_hash"
    assert len(v1) > 0

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        org = db.query(Organization).first()
        if not org:
            print("no org in db — analytics unit checks only")
            print("OK")
            return

        stats = reindex_org(db, org.id, limit_leads=5, prefer_local=True)
        print("reindex stats:", stats)
        n = db.query(CrmIndexChunk).filter(CrmIndexChunk.org_id == org.id).count()
        print("chunk count:", n)
        hits = retrieve_crm_context(db, org.id, "لید داغ فروش", k=3)
        print("crm hits:", len(hits))
        report = analytics_for_message(
            db, org.id, "ده تا از داغ ترین لیدها", use_llm_fallback=False
        )
        print("analytics sample len:", len(report or ""))
        print("OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()
