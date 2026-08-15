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
from app.services.queue import dequeue, dequeue_due
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


def _enrich_lock_path(message_id: str) -> Path:
    return _LOCK_DIR / f"en_{message_id.strip()}.lock"


def _try_lock_enrich(message_id: str) -> bool:
    mid = (message_id or "").strip()
    if not mid:
        return True
    _LOCK_DIR.mkdir(parents=True, exist_ok=True)
    path = _enrich_lock_path(mid)
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
        return True


def _release_enrich_lock(message_id: str) -> None:
    mid = (message_id or "").strip()
    if not mid:
        return
    try:
        _enrich_lock_path(mid).unlink(missing_ok=True)
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
        if (msg.body or "").strip() in ("", "(sync)", "[]"):
            trace_event(trace_id, "auto_reply_skip", reason="empty_body")
            return _auto_reply_result("skipped", "empty_body")
        body_stripped = (msg.body or "").strip()
        if body_stripped.startswith("[") and body_stripped.endswith("]") and len(body_stripped) <= 24:
            # Media placeholder like [استیکر] — no text for RAG reply
            trace_event(trace_id, "auto_reply_skip", reason="media_placeholder")
            return _auto_reply_result("skipped", "media_placeholder")
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

        from app.services.policy_gates import meets_min_confidence, within_business_hours
        from app.services.ai_events import record_ai_event

        if not within_business_hours(policy):
            record_ai_event(
                db,
                org_id=org.id,
                event_type="auto_reply_skip",
                lead_id=lead.id,
                payload={"reason": "outside_business_hours"},
            )
            db.commit()
            trace_event(trace_id, "auto_reply_skip", reason="outside_business_hours")
            safe_print(f"[worker] auto_reply skip: outside_business_hours lead={lead.id}")
            return _auto_reply_result("skipped", "outside_business_hours")

        conf = float(result.get("confidence") or 0)
        # Intentional provider-fallback copy must still go out when auto_send is on.
        # Otherwise WA shows read+typing and never delivers the configured fallback text.
        is_fallback = bool(result.get("fallback_reason")) or str(
            result.get("provider") or ""
        ).strip().lower() == "fallback"
        if not is_fallback and not meets_min_confidence(policy, conf):
            record_ai_event(
                db,
                org_id=org.id,
                event_type="auto_reply_skip",
                lead_id=lead.id,
                payload={
                    "reason": "below_min_confidence",
                    "confidence": conf,
                    "min_confidence": float(policy.min_confidence or 0),
                },
            )
            # Soft signal only — do not mark needs_human (that triggers risk UI / escalation)
            tags = list(lead.tags or [])
            if "follow_up" not in tags:
                tags.append("follow_up")
                lead.tags = tags
                db.add(lead)
            db.commit()
            trace_event(
                trace_id,
                "auto_reply_skip",
                reason="below_min_confidence",
                confidence=conf,
            )
            safe_print(
                f"[worker] auto_reply skip: below_min_confidence "
                f"conf={conf} min={policy.min_confidence} lead={lead.id}"
            )
            return _auto_reply_result("skipped", "below_min_confidence")

        if is_fallback:
            safe_print(
                f"[worker] auto_reply using fallback text "
                f"reason={result.get('fallback_reason')!r} lead={lead.id}"
            )
            trace_event(
                trace_id,
                "auto_reply_fallback_send",
                reason=result.get("fallback_reason") or "fallback",
                confidence=conf,
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
                delivery_status="pending",
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
        try:
            from app.services.ai_events import record_ai_event

            record_ai_event(
                db,
                org_id=org.id,
                event_type="auto_reply_queued",
                lead_id=lead.id,
                payload={
                    "job_id": job.id,
                    "confidence": result.get("confidence"),
                    "provider": result.get("provider"),
                },
            )
            db.commit()
        except Exception:  # noqa: BLE001
            pass
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


def handle_lead_enrich(payload: dict) -> dict:
    """Async CRM enrichment: tags, notes, score, optional stage/task/escalate."""
    message_id = str(payload.get("message_id") or "")
    org_id = str(payload.get("org_id") or "")
    lead_id = str(payload.get("lead_id") or "")
    if message_id and not _try_lock_enrich(message_id):
        return {"status": "skipped", "reason": "already_processing"}
    db = SessionLocal()
    try:
        org = db.get(Organization, org_id)
        lead = db.get(Lead, lead_id)
        msg = db.get(Message, message_id) if message_id else None
        if not org or not lead:
            return {"status": "skipped", "reason": "org_or_lead_missing"}
        if msg and (msg.body or "").strip() in ("", "(sync)"):
            return {"status": "skipped", "reason": "empty_body"}

        # Idempotent: skip if already enriched for this message
        meta = dict(lead.ai_meta or {}) if isinstance(lead.ai_meta, dict) else {}
        if message_id and meta.get("last_message_id") == message_id:
            return {"status": "skipped", "reason": "already_enriched"}

        policy = db.query(AiPolicy).filter(AiPolicy.org_id == org.id).first()
        from app.services.lead_enrich import apply_enrichment_to_lead, generate_enrichment
        from app.services.ai_events import record_ai_event

        body_text = (msg.body if msg else "") or str(payload.get("body") or "")
        enrichment = generate_enrichment(
            db, org_id=org.id, lead=lead, message=body_text
        )
        applied = apply_enrichment_to_lead(
            db,
            org_id=org.id,
            lead=lead,
            enrichment=enrichment,
            message_id=message_id,
            policy=policy,
        )
        db.add(lead)
        record_ai_event(
            db,
            org_id=org.id,
            event_type="lead_enriched",
            lead_id=lead.id,
            payload={
                "tags_added": applied.get("tags_added"),
                "lead_score": applied.get("lead_score"),
                "buying_intent": applied.get("buying_intent"),
                "sentiment": applied.get("sentiment"),
                "suggested_stage": applied.get("suggested_stage"),
                "stage_applied": applied.get("stage_applied"),
                "task_id": applied.get("task_id"),
                "escalated": applied.get("escalated"),
                "confidence": applied.get("confidence"),
            },
        )
        if applied.get("escalated"):
            record_ai_event(
                db,
                org_id=org.id,
                event_type="lead_escalated",
                lead_id=lead.id,
                payload={
                    "bot_paused": applied.get("bot_paused"),
                    "task_id": applied.get("task_id"),
                    "sentiment": applied.get("sentiment"),
                },
            )
        db.commit()

        # Hot-lead org signal for floating mascot / live UI
        try:
            intent = float(applied.get("buying_intent") or 0)
            tags = set(applied.get("tags") or lead.tags or [])
            hot = intent >= 75.0 or bool({"ready_to_buy", "high_intent"}.intersection(tags))
            if hot and not applied.get("escalated"):
                from app.services.sse_hub import publish_org_event

                publish_org_event(
                    org.id,
                    "hot_lead",
                    {
                        "lead_id": lead.id,
                        "name": (lead.name or "").strip() or "لید",
                        "buying_intent": intent,
                        "lead_score": applied.get("lead_score"),
                        "tags": sorted(tags.intersection({"ready_to_buy", "high_intent", "qualified"})),
                        "stage": lead.stage or "",
                    },
                )
        except Exception:  # noqa: BLE001
            pass

        safe_print(
            f"[worker] lead_enrich ok lead={lead.id} score={applied.get('lead_score')} "
            f"intent={applied.get('buying_intent')} tags={applied.get('tags_added')} "
            f"escalated={applied.get('escalated')}"
        )
        return {"status": "ok", **applied}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        safe_print(f"[worker] lead_enrich error: {e}")
        return {"status": "error", "reason": str(e)}
    finally:
        db.close()
        if message_id:
            _release_enrich_lock(message_id)


def handle_campaign_send(payload: dict) -> dict:
    """Process one campaign: create outbound jobs for matching pending sends."""
    campaign_id = str(payload.get("campaign_id") or "")
    org_id = str(payload.get("org_id") or "")
    db = SessionLocal()
    try:
        from app.models import (
            Campaign,
            CampaignSend,
            ChannelAccount,
            LeadAccountLink,
            OutboundJob,
            OutboundStatus,
            SenderType,
        )
        from app.services.queue import enqueue
        from app.services.wa_jid import resolve_outbound_target, resolve_target_jid
        from app.services.policy_gates import within_business_hours

        camp = db.get(Campaign, campaign_id)
        if not camp or camp.org_id != org_id:
            return {"status": "skipped", "reason": "campaign_missing"}
        if camp.status not in ("running", "queued"):
            return {"status": "skipped", "reason": f"status_{camp.status}"}

        policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
        if not within_business_hours(policy):
            # leave running; worker will retry later
            return {"status": "deferred", "reason": "outside_business_hours"}

        acc = db.get(ChannelAccount, camp.channel_account_id) if camp.channel_account_id else None
        if not acc or acc.org_id != org_id:
            camp.status = "paused"
            db.add(camp)
            db.commit()
            return {"status": "error", "reason": "account_missing"}

        pending = (
            db.query(CampaignSend)
            .filter(
                CampaignSend.campaign_id == camp.id,
                CampaignSend.status == "pending",
            )
            .limit(40)
            .all()
        )
        if not pending:
            open_n = (
                db.query(CampaignSend)
                .filter(
                    CampaignSend.campaign_id == camp.id,
                    CampaignSend.status.in_(("pending", "queued")),
                )
                .count()
            )
            if open_n == 0:
                camp.status = "done"
                camp.finished_at = datetime.utcnow()
                db.add(camp)
                db.commit()
                return {"status": "done"}
            # Jobs still with connector — wait for completions
            return {"status": "waiting_connector", "open": open_n}

        from app.services.campaign_send import render_campaign_body

        body_tpl = (camp.message_template or "").strip()
        queued = 0
        for row in pending:
            lead = db.get(Lead, row.lead_id)
            if not lead:
                row.status = "skipped"
                row.error = "lead_missing"
                db.add(row)
                continue
            if (lead.chat_type or "").lower() == "group":
                seg = camp.segment_json or {}
                if not seg.get("include_groups"):
                    row.status = "skipped"
                    row.error = "group_excluded"
                    db.add(row)
                    continue
            link = (
                db.query(LeadAccountLink)
                .filter(
                    LeadAccountLink.org_id == org_id,
                    LeadAccountLink.lead_id == lead.id,
                    LeadAccountLink.account_id == acc.id,
                )
                .first()
            )
            if not link:
                link = (
                    db.query(LeadAccountLink)
                    .filter(
                        LeadAccountLink.org_id == org_id,
                        LeadAccountLink.lead_id == lead.id,
                    )
                    .first()
                )
            account_id = (link.account_id if link else None) or acc.id
            target = resolve_outbound_target(lead, link)
            body = render_campaign_body(body_tpl, lead)
            job = OutboundJob(
                org_id=org_id,
                account_id=account_id,
                lead_id=lead.id,
                target_name=target,
                target_jid=resolve_target_jid(lead, link),
                body=body,
                sender_type=SenderType.agent,
                created_by_id=camp.created_by_id,
                status=OutboundStatus.queued,
            )
            db.add(job)
            db.flush()
            db.add(
                Message(
                    org_id=org_id,
                    account_id=account_id,
                    lead_id=lead.id,
                    direction=MessageDirection.outbound,
                    sender_type=SenderType.agent,
                    body=body,
                )
            )
            row.status = "queued"
            row.job_id = job.id
            db.add(row)
            enqueue("outbound_send", {"job_id": job.id, "org_id": org_id})
            queued += 1
            try:
                from app.services.sse_hub import publish_job_ready

                publish_job_ready(
                    account_id, job_id=job.id, reason="campaign_send", org_id=org_id
                )
            except Exception:  # noqa: BLE001
                pass

        remaining = (
            db.query(CampaignSend)
            .filter(CampaignSend.campaign_id == camp.id, CampaignSend.status == "pending")
            .count()
        )
        # Keep running while connector still has queued jobs — finish only when all
        # rows are terminal (sent / failed / skipped).
        open_n = (
            db.query(CampaignSend)
            .filter(
                CampaignSend.campaign_id == camp.id,
                CampaignSend.status.in_(("pending", "queued")),
            )
            .count()
        )
        if open_n == 0:
            camp.status = "done"
            camp.finished_at = datetime.utcnow()
        else:
            camp.status = "running"
            if remaining > 0:
                enqueue("campaign_send", {"campaign_id": camp.id, "org_id": org_id})
        db.add(camp)
        db.commit()
        return {"status": "ok", "queued": queued, "remaining": remaining}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        safe_print(f"[worker] campaign_send error: {e}")
        return {"status": "error", "reason": str(e)}
    finally:
        db.close()


def handle_follow_up(payload: dict) -> dict:
    """Delayed silent-follow-up after unanswered inbound."""
    db = SessionLocal()
    try:
        from app.services.follow_up_seq import handle_follow_up_job
        from app.services.ai_events import record_ai_event

        result = handle_follow_up_job(db, payload)
        if result.get("status") == "queued":
            record_ai_event(
                db,
                org_id=str(payload.get("org_id") or ""),
                event_type="follow_up_queued",
                lead_id=str(payload.get("lead_id") or ""),
                payload={
                    "job_id": result.get("job_id"),
                    "step": result.get("step"),
                    "next_step": result.get("next_step"),
                },
            )
        db.commit()
        safe_print(
            f"[worker] follow_up {result.get('status')} lead={payload.get('lead_id')} "
            f"step={payload.get('step')} reason={result.get('reason', '')}"
        )
        return result
    except Exception as e:  # noqa: BLE001
        db.rollback()
        safe_print(f"[worker] follow_up error: {e}")
        return {"status": "error", "reason": str(e)}
    finally:
        db.close()


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
        enrich_job = dequeue("lead_enrich")
        if enrich_job:
            handle_lead_enrich(enrich_job)
            continue
        follow_job = dequeue_due("follow_up")
        if follow_job:
            handle_follow_up(follow_job)
            continue
        camp_job = dequeue("campaign_send")
        if camp_job:
            handle_campaign_send(camp_job)
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
