from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth
from app.models import (
    Lead,
    LeadAccountLink,
    Message,
    MessageDirection,
    OutboundJob,
    OutboundStatus,
    SenderType,
    WhatsAppAccount,
)
from app.plans import plan_limits
from app.schemas import MessageIngestIn, MessageOut, OutboundJobOut, SendMessageIn
from app.services.queue import enqueue

router = APIRouter(prefix="/messages", tags=["messages"])


def _to_out(m: Message) -> MessageOut:
    return MessageOut(
        id=m.id,
        account_id=m.account_id,
        lead_id=m.lead_id,
        direction=m.direction.value,
        sender_type=m.sender_type.value,
        body=m.body,
        agent_id=m.agent_id,
        created_at=m.created_at,
    )


def _upsert_lead_from_ingest(db: Session, org_id: str, body: MessageIngestIn) -> Lead:
    link = (
        db.query(LeadAccountLink)
        .filter(
            LeadAccountLink.org_id == org_id,
            LeadAccountLink.account_id == body.account_id,
            LeadAccountLink.chat_name == body.chat_name,
        )
        .first()
    )
    if link:
        lead = db.get(Lead, link.lead_id)
        if lead:
            if body.phone and not lead.phone:
                lead.phone = body.phone
            if body.group_id and not lead.group_id:
                lead.group_id = body.group_id
            lead.last_message_at = datetime.utcnow()
            lead.updated_at = datetime.utcnow()
            db.add(lead)
            return lead

    lead = None
    if body.phone:
        lead = db.query(Lead).filter(Lead.org_id == org_id, Lead.phone == body.phone).first()
    if not lead and body.group_id:
        lead = db.query(Lead).filter(Lead.org_id == org_id, Lead.group_id == body.group_id).first()
    if not lead:
        lead = Lead(
            org_id=org_id,
            name=body.chat_name,
            phone=body.phone if body.chat_type != "group" else "",
            group_id=body.group_id if body.chat_type == "group" else "",
            chat_type=body.chat_type or "pv",
        )
        db.add(lead)
        db.flush()
    else:
        lead.last_message_at = datetime.utcnow()
        lead.updated_at = datetime.utcnow()
        db.add(lead)

    db.add(
        LeadAccountLink(
            org_id=org_id,
            lead_id=lead.id,
            account_id=body.account_id,
            chat_name=body.chat_name,
        )
    )
    return lead


@router.post("/ingest", response_model=MessageOut)
def ingest(body: MessageIngestIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    acc = (
        db.query(WhatsAppAccount)
        .filter(WhatsAppAccount.id == body.account_id, WhatsAppAccount.org_id == auth.org.id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت واتساپ یافت نشد")

    lead = _upsert_lead_from_ingest(db, auth.org.id, body)
    msg = Message(
        org_id=auth.org.id,
        account_id=body.account_id,
        lead_id=lead.id,
        direction=MessageDirection(body.direction),
        sender_type=SenderType(body.sender_type),
        body=body.body,
        wa_message_id=body.wa_message_id,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    if body.direction == "inbound":
        enqueue("auto_reply", {"org_id": auth.org.id, "lead_id": lead.id, "message_id": msg.id})

    return _to_out(msg)


@router.get("/inbox", response_model=list[MessageOut])
def inbox(
    lead_id: str | None = None,
    account_id: str | None = None,
    limit: int = Query(default=100, le=500),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    q = db.query(Message).filter(Message.org_id == auth.org.id)
    if lead_id:
        q = q.filter(Message.lead_id == lead_id)
    if account_id:
        q = q.filter(Message.account_id == account_id)
    rows = q.order_by(Message.created_at.desc()).limit(limit).all()
    return [_to_out(r) for r in rows]


@router.get("/threads")
def threads(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    """Aggregated inbox threads across all WA numbers in the org."""
    leads = (
        db.query(Lead)
        .filter(Lead.org_id == auth.org.id)
        .order_by(Lead.updated_at.desc())
        .limit(200)
        .all()
    )
    out = []
    for lead in leads:
        last = (
            db.query(Message)
            .filter(Message.org_id == auth.org.id, Message.lead_id == lead.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        links = (
            db.query(LeadAccountLink)
            .filter(LeadAccountLink.org_id == auth.org.id, LeadAccountLink.lead_id == lead.id)
            .all()
        )
        out.append(
            {
                "lead": {
                    "id": lead.id,
                    "name": lead.name,
                    "phone": lead.phone,
                    "group_id": lead.group_id,
                    "stage": lead.stage,
                    "assignee_id": lead.assignee_id,
                },
                "accounts": [{"account_id": l.account_id, "chat_name": l.chat_name} for l in links],
                "last_message": _to_out(last) if last else None,
            }
        )
    return out


@router.post("/send", response_model=OutboundJobOut)
def send_message(body: SendMessageIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    limits = plan_limits(auth.org.plan)
    if body.sender_type == "ai" and not limits["ai_auto_send"]:
        raise HTTPException(status_code=402, detail="پلن شما ارسال خودکار AI ندارد")

    acc = (
        db.query(WhatsAppAccount)
        .filter(WhatsAppAccount.id == body.account_id, WhatsAppAccount.org_id == auth.org.id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت واتساپ یافت نشد")

    job = OutboundJob(
        org_id=auth.org.id,
        account_id=body.account_id,
        lead_id=body.lead_id,
        target_name=body.target_name,
        body=body.body,
        sender_type=SenderType(body.sender_type),
        created_by_id=auth.user.id,
        status=OutboundStatus.queued,
    )
    db.add(job)
    db.flush()

    if body.lead_id:
        db.add(
            Message(
                org_id=auth.org.id,
                account_id=body.account_id,
                lead_id=body.lead_id,
                direction=MessageDirection.outbound,
                sender_type=SenderType(body.sender_type),
                body=body.body,
                agent_id=auth.user.id if body.sender_type == "agent" else None,
            )
        )

    db.commit()
    db.refresh(job)
    enqueue("outbound_send", {"job_id": job.id, "org_id": auth.org.id})
    return OutboundJobOut(
        id=job.id,
        account_id=job.account_id,
        lead_id=job.lead_id,
        target_name=job.target_name,
        body=job.body,
        sender_type=job.sender_type.value,
        status=job.status.value,
    )
