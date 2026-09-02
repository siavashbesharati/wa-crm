"""End-to-end verification for Hybrid RAG + SQL coach stack."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    CrmIndexChunk,
    Lead,
    Message,
    Organization,
    Task,
    TaskStatus,
)
from app.services.crm_index import retrieve_crm_context  # noqa: E402
from app.services.org_analytics import (  # noqa: E402
    ANALYTICS_KINDS,
    analytics_for_message,
    detect_analytics_intents,
    parse_requested_limit,
)


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "PASS" if ok else "FAIL"
    line = f"[{status}] {name}"
    if detail:
        line += f" — {detail}"
    print(line)
    return ok


def main() -> int:
    failures = 0

    # --- unit: intent detection ---
    failures += 0 if check(
        "parse_limit_persian_10",
        parse_requested_limit("ده تا از داغ ترین لیدها") == 10,
    ) else 1
    failures += 0 if check(
        "intent_hot_today",
        "hot_today" in detect_analytics_intents("ده تا از داغ ترین لیدها"),
    ) else 1
    failures += 0 if check(
        "intent_tasks_completed",
        "tasks_completed" in detect_analytics_intents(
            "کدام کارمند تسک های بیشتری انجام داده"
        ),
    ) else 1
    failures += 0 if check(
        "intent_lead_playbook",
        "lead_playbook" in detect_analytics_intents("پیشنهاد بر اساس گفتگو"),
    ) else 1
    failures += 0 if check(
        "analytics_kinds_include_new",
        {"tasks_completed", "lead_playbook"}.issubset(ANALYTICS_KINDS),
    ) else 1

    db = SessionLocal()
    try:
        org = (
            db.query(Organization)
            .filter(Organization.name == get_settings().demo_org_name)
            .first()
        )
        if not org:
            org = db.query(Organization).first()
        if not org:
            check("demo_org_exists", False)
            return 1

        org_id = org.id
        check("demo_org_exists", True, f"id={org_id}")

        # --- data: tasks kanban ---
        task_counts = {}
        for status in TaskStatus:
            task_counts[status.value] = (
                db.query(Task)
                .filter(Task.org_id == org_id, Task.status == status)
                .count()
            )
        total_tasks = sum(task_counts.values())
        failures += 0 if check(
            "tasks_seeded",
            total_tasks >= 40,
            f"total={total_tasks} by_status={task_counts}",
        ) else 1

        # --- data: inbox messages ---
        msg_count = db.query(Message).filter(Message.org_id == org_id).count()
        lead_count = db.query(Lead).filter(Lead.org_id == org_id).count()
        failures += 0 if check(
            "inbox_messages",
            msg_count >= 20,
            f"messages={msg_count} leads={lead_count}",
        ) else 1

        # --- CRM index ---
        chunk_total = (
            db.query(CrmIndexChunk).filter(CrmIndexChunk.org_id == org_id).count()
        )
        by_type: dict[str, int] = {}
        for (etype,) in (
            db.query(CrmIndexChunk.entity_type)
            .filter(CrmIndexChunk.org_id == org_id)
            .distinct()
        ):
            by_type[etype] = (
                db.query(CrmIndexChunk)
                .filter(
                    CrmIndexChunk.org_id == org_id,
                    CrmIndexChunk.entity_type == etype,
                )
                .count()
            )
        failures += 0 if check(
            "crm_index_chunks",
            chunk_total >= 30,
            f"total={chunk_total} by_type={by_type}",
        ) else 1

        # chunks should have embeddings
        with_emb = (
            db.query(CrmIndexChunk)
            .filter(CrmIndexChunk.org_id == org_id, CrmIndexChunk.embedding.isnot(None))
            .count()
        )
        failures += 0 if check(
            "crm_embeddings_present",
            with_emb >= chunk_total * 0.9,
            f"with_embedding={with_emb}/{chunk_total}",
        ) else 1

        # --- SQL analytics reports ---
        hot = analytics_for_message(
            db, org_id, "ده تا از داغ ترین لیدها", use_llm_fallback=False
        )
        failures += 0 if check(
            "analytics_hot_leads",
            bool(hot) and len(hot) > 100,
            f"chars={len(hot or '')}",
        ) else 1

        tasks_r = analytics_for_message(
            db,
            org_id,
            "کدام کارمند تسک های بیشتری انجام داده",
            use_llm_fallback=False,
        )
        failures += 0 if check(
            "analytics_tasks_completed",
            bool(tasks_r) and len(tasks_r) > 50,
            f"chars={len(tasks_r or '')}",
        ) else 1

        playbook = analytics_for_message(
            db,
            org_id,
            "پیشنهاد بر اساس گفتگو",
            use_llm_fallback=False,
        )
        failures += 0 if check(
            "analytics_lead_playbook",
            bool(playbook) and len(playbook) > 50,
            f"chars={len(playbook or '')}",
        ) else 1

        # --- CRM RAG retrieval ---
        hits = retrieve_crm_context(db, org_id, "وام بانکی بازدید", k=5)
        failures += 0 if check(
            "crm_rag_retrieval",
            len(hits) >= 1,
            f"hits={len(hits)} top_score={hits[0][1]:.3f}" if hits else "hits=0",
        ) else 1

        # --- coach wire imports ---
        try:
            from app.services.coach_tools import maybe_run_coach_tools  # noqa: F401
            from app.services.pir_kharabat import run_coach_turn  # noqa: F401

            failures += 0 if check("coach_modules_import", True) else 1
        except Exception as exc:  # noqa: BLE001
            failures += 0 if check("coach_modules_import", False, str(exc)) else 1

        # --- worker handler import ---
        try:
            from app.services.crm_index import handle_crm_index_job  # noqa: F401

            failures += 0 if check("worker_crm_index_handler", True) else 1
        except Exception as exc:  # noqa: BLE001
            failures += 0 if check("worker_crm_index_handler", False, str(exc)) else 1

    finally:
        db.close()

    print("---")
    if failures == 0:
        print("ALL CHECKS PASSED")
        return 0
    print(f"{failures} CHECK(S) FAILED")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
