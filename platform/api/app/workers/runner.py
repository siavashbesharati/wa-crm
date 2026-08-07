"""Background workers for embed / auto_reply / kpi_rollup queues."""

from __future__ import annotations

import time
from datetime import datetime

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


def handle_auto_reply(payload: dict) -> None:
    db = SessionLocal()
    try:
        org = db.get(Organization, payload["org_id"])
        if not org:
            return
        policy = db.query(AiPolicy).filter(AiPolicy.org_id == org.id).first()
        if not policy or not policy.auto_send_enabled:
            return
        lead = db.get(Lead, payload["lead_id"])
        msg = db.get(Message, payload["message_id"])
        if not lead or not msg or lead.bot_paused:
            return
        if lead.stage not in (policy.allowed_stages or []):
            return

        result = generate_reply(db, org_id=org.id, lead=lead, message=msg.body)
        if float(result["confidence"]) < float(policy.min_confidence or 0):
            print(
                f"[worker] auto_reply skip low_confidence={result['confidence']} "
                f"min={policy.min_confidence} lead={lead.id}"
            )
            return

        link = (
            db.query(LeadAccountLink)
            .filter(LeadAccountLink.org_id == org.id, LeadAccountLink.lead_id == lead.id)
            .first()
        )
        if not link:
            return
        reply = result["reply"]
        job = OutboundJob(
            org_id=org.id,
            account_id=link.account_id,
            lead_id=lead.id,
            target_name=lead.name,
            body=reply,
            sender_type=SenderType.ai,
            status=OutboundStatus.queued,
        )
        db.add(job)
        db.add(
            Message(
                org_id=org.id,
                account_id=link.account_id,
                lead_id=lead.id,
                direction=MessageDirection.outbound,
                sender_type=SenderType.ai,
                body=reply,
            )
        )
        db.commit()
        print(
            f"[worker] auto_reply queued job={job.id} lead={lead.id} "
            f"provider={result.get('provider')}"
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
