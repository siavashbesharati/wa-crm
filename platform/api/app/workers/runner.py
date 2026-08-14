"""Background workers for embed / auto_reply / kpi_rollup queues."""

from __future__ import annotations

from app.services.stdio_utf8 import configure_stdio, safe_print

configure_stdio()

import os
import time
from datetime import datetime
from pathlib import Path

from app.database import SessionLocal
from app.models import (
    AiPolicy,
    Lead,
    LeadAccountLink,
    Message,
    MessageDirection,
    Organization,
    OutboundJob,
    OutboundStatus,
    SenderType,
)
from app.routers.kpi import rollup
from app.services.ai_reply import generate_reply
from app.services.queue import dequeue
from app.services.reply_trace import link_job_trace, trace_event

_LOCK_DIR = Path(__file__).resolve().parents[2] / "data" / "locks"
_LOCK_STALE_SEC = 300  # allow retry if a prior auto_reply crashed mid-flight


def _lock_path(message_id: str) -> Path:
    return _LOCK_DIR / f"ar_{message_id.strip()}.lock"


def _release_lock(message_id: str) -> None:
    mid = (message_id or "").strip()
    if not mid:
        return
    try:
        _lock_path(mid).unlink(missing_ok=True)
    except OSError:
        pass


def _try_lock_message(message_id: str) -> bool:
    """Prevent duplicate auto_reply for the same inbound message (Windows-safe)."""
    mid = (message_id or "").strip()
    if not mid:
        return False
    _LOCK_DIR.mkdir(parents=True, exist_ok=True)
    path = _lock_path(mid)
    if path.exists():
        try:
            age = time.time() - path.stat().st_mtime
            if age >= _LOCK_STALE_SEC:
                path.unlink(missing_ok=True)
        except OSError:
            pass
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(time.time()).encode("ascii", errors="ignore"))
        os.close(fd)
        return True
    except FileExistsError:
        return False
    except OSError:
        return True  # if lock filesystem fails, still try to reply


def _outbound_target(lead: Lead, link: LeadAccountLink | None = None) -> str:
    """Prefer Divar/WA chat id over display name so the extension can open the right chat."""
    from app.services.wa_jid import resolve_outbound_target

    return resolve_outbound_target(lead, link)


def _auto_reply_result(status: str, reason: str = "", job_id: str = "") -> dict:
    return {
        "status": status,
        "reason": reason or "",
        "job_id": job_id or "",
    }


def handle_auto_reply(payload: dict) -> dict:
    message_id = str(payload.get("message_id") or "")
    trace_id = str(payload.get("trace_id") or "")
    trace_event(trace_id, "auto_reply_start", message_id=message_id)
    if not _try_lock_message(message_id):
        trace_event(trace_id, "auto_reply_skip", reason="already_processing")
        safe_print(f"[worker] auto_reply skip: already processing message={message_id}")
        return _auto_reply_result("skipped", "already_processing")
    db = SessionLocal()
    try:
        org = db.get(Organization, payload["org_id"])
        if not org:
            trace_event(trace_id, "auto_reply_skip", reason="org_missing")
            return _auto_reply_result("skipped", "org_missing")
        policy = db.query(AiPolicy).filter(AiPolicy.org_id == org.id).first()
        if not policy or not policy.auto_send_enabled:
            trace_event(trace_id, "auto_reply_skip", reason="auto_send_disabled")
            safe_print(f"[worker] auto_reply skip: auto_send disabled org={payload.get('org_id')}")
            return _auto_reply_result("skipped", "auto_send_disabled")
        lead = db.get(Lead, payload["lead_id"])
        msg = db.get(Message, payload["message_id"])
        if not lead or not msg or lead.bot_paused:
            if lead and lead.bot_paused:
                trace_event(trace_id, "auto_reply_skip", reason="bot_paused")
                safe_print(f"[worker] auto_reply skip: bot_paused lead={lead.id}")
                return _auto_reply_result("skipped", "bot_paused")
            trace_event(trace_id, "auto_reply_skip", reason="lead_or_msg_missing")
            return _auto_reply_result("skipped", "lead_or_msg_missing")
        if (msg.body or "").strip() in ("", "(sync)"):
            trace_event(trace_id, "auto_reply_skip", reason="empty_body")
            return _auto_reply_result("skipped", "empty_body")
        if lead.stage not in (policy.allowed_stages or []):
            trace_event(
                trace_id,
                "auto_reply_skip",
                reason="stage_not_allowed",
                stage=lead.stage,
            )
            safe_print(
                f"[worker] auto_reply skip: stage={lead.stage!r} "
                f"allowed={policy.allowed_stages} lead={lead.id}"
            )
            return _auto_reply_result("skipped", "stage_not_allowed")
        from app.services.group_reply import evaluate_group_auto_reply, lead_looks_like_group

        is_group = lead_looks_like_group(
            lead,
            chat_type=str(payload.get("chat_type") or lead.chat_type or ""),
            group_id=str(payload.get("group_id") or lead.group_id or ""),
            external_chat_id=str(
                payload.get("external_chat_id") or lead.external_chat_id or ""
            ),
        )
        if is_group:
            allow_group, group_reason = evaluate_group_auto_reply(policy, msg.body or "")
            if not allow_group:
                trace_event(trace_id, "auto_reply_skip", reason=group_reason)
                safe_print(
                    f"[worker] auto_reply skip: {group_reason} lead={lead.id}"
                )
                return _auto_reply_result("skipped", group_reason)
            trace_event(trace_id, "group_keyword_matched", reason=group_reason)

        # Idempotent: already queued an AI reply for THIS inbound message (short window).
        # Do not use open-ended created_at >= msg.created_at — later replies to other
        # messages on the same lead would permanently block older / deduped ones.
        from datetime import timedelta

        window_end = msg.created_at + timedelta(minutes=3)
        already = (
            db.query(OutboundJob)
            .filter(
                OutboundJob.org_id == org.id,
                OutboundJob.lead_id == lead.id,
                OutboundJob.sender_type == SenderType.ai,
                OutboundJob.created_at >= msg.created_at,
                OutboundJob.created_at <= window_end,
            )
            .first()
        )
        if already:
            trace_event(trace_id, "auto_reply_skip", reason="already_queued")
            return _auto_reply_result("skipped", "already_queued", job_id=already.id)

        trace_event(trace_id, "ai_generate_start", lead_id=lead.id)
        result = generate_reply(db, org_id=org.id, lead=lead, message=msg.body)
        reply_preview = str(result.get("reply") or "")[:120]
        trace_event(
            trace_id,
            "ai_generate_done",
            provider=result.get("provider"),
            confidence=result.get("confidence"),
            knowledge_hits=result.get("knowledge_hits", 0),
            knowledge_top_score=result.get("knowledge_top_score", 0),
            reply_preview=reply_preview,
            fallback_reason=result.get("fallback_reason") or "",
            error_detail=result.get("error_detail") or "",
        )
        # Prefer the same channel account that received the inbound message
        link = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org.id,
                LeadAccountLink.lead_id == lead.id,
                LeadAccountLink.account_id == msg.account_id,
            )
            .first()
        )
        if not link:
            link = (
                db.query(LeadAccountLink)
                .filter(LeadAccountLink.org_id == org.id, LeadAccountLink.lead_id == lead.id)
                .first()
            )
        if not link:
            trace_event(trace_id, "auto_reply_skip", reason="no_account_link")
            safe_print(f"[worker] auto_reply skip: no LeadAccountLink lead={lead.id}")
            return _auto_reply_result("skipped", "no_account_link")

        # Do NOT mutate lead_account_links here — filling external_chat_id can hit
        # UNIQUE(org, account, external_chat_id) and abort the whole reply commit.
        # _outbound_target already falls back to lead.external_chat_id / phone / name.

        account_id = msg.account_id or link.account_id
        target = _outbound_target(lead, link)
        from app.services.wa_jid import resolve_target_jid

        reply = result["reply"]
        job = OutboundJob(
            org_id=org.id,
            account_id=account_id,
            lead_id=lead.id,
            target_name=target,
            target_jid=resolve_target_jid(lead, link),
            body=reply,
            sender_type=SenderType.ai,
            status=OutboundStatus.queued,
        )
        db.add(job)
        db.add(
            Message(
                org_id=org.id,
                account_id=account_id,
                lead_id=lead.id,
                direction=MessageDirection.outbound,
                sender_type=SenderType.ai,
                body=reply,
            )
        )
        try:
            db.commit()
        except Exception as commit_err:  # noqa: BLE001
            db.rollback()
            trace_event(trace_id, "auto_reply_error", error=str(commit_err))
            safe_print(f"[worker] auto_reply commit error: {commit_err}")
            return _auto_reply_result("error", str(commit_err))
        link_job_trace(job.id, trace_id)
        try:
            from app.services.sse_hub import publish_job_ready

            publish_job_ready(
                account_id, job_id=job.id, reason="ai_reply", org_id=org.id
            )
        except Exception:  # noqa: BLE001
            pass
        trace_event(
            trace_id,
            "outbound_job_queued",
            job_id=job.id,
            target=target,
            provider=result.get("provider"),
        )
        safe_print(
            f"[worker] auto_reply queued job={job.id} lead={lead.id} "
            f"target={target!r} provider={result.get('provider')} "
            f"confidence={result.get('confidence')}"
        )
        return _auto_reply_result(
            "queued",
            f"provider={result.get('provider')}",
            job_id=job.id,
        )
    except Exception as e:
        trace_event(trace_id, "auto_reply_error", error=str(e))
        safe_print(f"[worker] auto_reply error: {e}")
        return _auto_reply_result("error", str(e))
    finally:
        db.close()
        _release_lock(message_id)


def handle_kpi(payload: dict) -> None:
    # Lightweight recompute without HTTP auth context
    from app.deps import AuthContext
    from app.models import Membership, User

    db = SessionLocal()
    try:
        org = db.get(Organization, payload["org_id"])
        if not org:
            return
        membership = db.query(Membership).filter(Membership.org_id == org.id).first()
        user = db.get(User, membership.user_id) if membership else None
        if not user or not membership:
            return
        auth = AuthContext(user=user, org=org, membership=membership)
        rollup(auth, db)
        safe_print(f"[worker] kpi rollup org={org.id} at {datetime.utcnow().isoformat()}")
    finally:
        db.close()


def main() -> None:
    safe_print("[worker] started")
    while True:
        job = dequeue("auto_reply")
        if job:
            handle_auto_reply(job)
            continue
        kpi_job = dequeue("kpi_rollup")
        if kpi_job:
            handle_kpi(kpi_job)
            continue
        # drain embed — retry Pinecone upsert when upload-time push failed
        embed_job = dequeue("embed")
        if embed_job:
            doc_id = str(embed_job.get("doc_id") or "")
            org_id = str(embed_job.get("org_id") or "")
            already_ok = bool(embed_job.get("pinecone_ok"))
            if already_ok:
                safe_print(f"[worker] embed ack (pinecone ok) doc={doc_id}")
                continue
            if not doc_id or not org_id:
                safe_print(f"[worker] embed skip incomplete job={embed_job}")
                continue
            db = SessionLocal()
            try:
                from app.services import pinecone_kb

                if not pinecone_kb.is_configured(db):
                    safe_print(f"[worker] embed skip (no pinecone key) doc={doc_id}")
                else:
                    n = pinecone_kb.upsert_doc_from_db(db, org_id=org_id, doc_id=doc_id)
                    safe_print(f"[worker] pinecone upsert doc={doc_id} chunks={n}")
            except Exception as exc:  # noqa: BLE001
                safe_print(f"[worker] pinecone upsert failed doc={doc_id}: {exc}")
            finally:
                db.close()
            continue
        time.sleep(1)


if __name__ == "__main__":
    main()
