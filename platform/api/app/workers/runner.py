"""Background workers for embed / auto_reply / kpi_rollup queues."""

from __future__ import annotations

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

_LOCK_DIR = Path(__file__).resolve().parents[2] / "data" / "locks"


def _try_lock_message(message_id: str) -> bool:
    """Prevent duplicate auto_reply for the same inbound message (Windows-safe)."""
    mid = (message_id or "").strip()
    if not mid:
        return False
    _LOCK_DIR.mkdir(parents=True, exist_ok=True)
    path = _LOCK_DIR / f"ar_{mid}.lock"
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
    for candidate in (
        (link.external_chat_id if link else None),
        getattr(lead, "external_chat_id", None),
        lead.phone,
        lead.group_id,
        lead.name,
    ):
        t = (candidate or "").strip()
        if t:
            return t
    return (lead.name or "").strip()


def handle_auto_reply(payload: dict) -> None:
    message_id = str(payload.get("message_id") or "")
    if not _try_lock_message(message_id):
        print(f"[worker] auto_reply skip: already processing message={message_id}")
        return
    db = SessionLocal()
    try:
        org = db.get(Organization, payload["org_id"])
        if not org:
            return
        policy = db.query(AiPolicy).filter(AiPolicy.org_id == org.id).first()
        if not policy or not policy.auto_send_enabled:
            print(f"[worker] auto_reply skip: auto_send disabled org={payload.get('org_id')}")
            return
        # Soft-migrate stock defaults only (0.55 from platform / 0.72 legacy)
        mc = round(float(policy.min_confidence or 0), 2)
        if mc in (0.55, 0.72):
            policy.min_confidence = 0.45
            db.add(policy)
            db.commit()
        lead = db.get(Lead, payload["lead_id"])
        msg = db.get(Message, payload["message_id"])
        if not lead or not msg or lead.bot_paused:
            if lead and lead.bot_paused:
                print(f"[worker] auto_reply skip: bot_paused lead={lead.id}")
            return
        if (msg.body or "").strip() in ("", "(sync)"):
            return
        if lead.stage not in (policy.allowed_stages or []):
            print(
                f"[worker] auto_reply skip: stage={lead.stage!r} "
                f"allowed={policy.allowed_stages} lead={lead.id}"
            )
            return

        # Idempotent: already queued an AI reply for this inbound message
        already = (
            db.query(OutboundJob)
            .filter(
                OutboundJob.org_id == org.id,
                OutboundJob.lead_id == lead.id,
                OutboundJob.sender_type == SenderType.ai,
                OutboundJob.created_at >= msg.created_at,
            )
            .first()
        )
        if already:
            return

        result = generate_reply(db, org_id=org.id, lead=lead, message=msg.body)
        min_conf = float(policy.min_confidence or 0)
        is_fallback = (
            result.get("provider") == "fallback" or bool(result.get("force_send"))
        )
        if (not is_fallback) and float(result["confidence"]) < min_conf:
            print(
                f"[worker] auto_reply skip low_confidence={result['confidence']} "
                f"min={min_conf} lead={lead.id}"
            )
            return

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
            print(f"[worker] auto_reply skip: no LeadAccountLink lead={lead.id}")
            return

        # Keep external_chat_id fresh from inbound account when possible
        if not (link.external_chat_id or "").strip() and (lead.external_chat_id or "").strip():
            link.external_chat_id = lead.external_chat_id
            db.add(link)

        account_id = msg.account_id or link.account_id
        target = _outbound_target(lead, link)
        reply = result["reply"]
        job = OutboundJob(
            org_id=org.id,
            account_id=account_id,
            lead_id=lead.id,
            target_name=target,
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
        db.commit()
        print(
            f"[worker] auto_reply queued job={job.id} lead={lead.id} "
            f"target={target!r} provider={result.get('provider')} "
            f"confidence={result.get('confidence')}"
        )
    except Exception as e:
        print(f"[worker] auto_reply error: {e}")
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
        print(f"[worker] kpi rollup org={org.id} at {datetime.utcnow().isoformat()}")
    finally:
        db.close()


def main() -> None:
    print("[worker] started")
    while True:
        job = dequeue("auto_reply")
        if job:
            handle_auto_reply(job)
            continue
        kpi_job = dequeue("kpi_rollup")
        if kpi_job:
            handle_kpi(kpi_job)
            continue
        # drain embed (no-op — embeddings computed at upload)
        embed_job = dequeue("embed")
        if embed_job:
            print(f"[worker] embed ack doc={embed_job.get('doc_id')}")
            continue
        time.sleep(1)


if __name__ == "__main__":
    main()
