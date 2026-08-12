from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth
from app.models import (
    ChannelAccount,
    ChannelType,
    Lead,
    LeadAccountLink,
    Message,
    MessageDirection,
    OutboundJob,
    OutboundStatus,
    SenderType,
)
from app.plans import plan_limits
from app.schemas import MessageIngestIn, MessageOut, OutboundJobOut, SendMessageIn
from app.services.queue import enqueue

router = APIRouter(prefix="/messages", tags=["messages"])


def _run_auto_reply_job(payload: dict) -> None:
    """Process auto_reply in-process so it works even if the worker is down briefly."""
    try:
        from app.workers.runner import handle_auto_reply

        handle_auto_reply(payload)
    except Exception as e:  # noqa: BLE001
        print(f"[ingest] auto_reply background error: {e}")


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


def _touch_lead_from_ingest(
    lead: Lead,
    *,
    phone: str | None,
    external_chat_id: str | None,
    post_token: str,
    source_channel: str,
    body: MessageIngestIn,
    chat_name: str,
) -> None:
    if phone and not lead.phone:
        lead.phone = phone
    # Divar CRM often stores chat UUID in phone without external_chat_id
    if external_chat_id and not lead.phone:
        lead.phone = external_chat_id
    if body.group_id and not lead.group_id:
        lead.group_id = body.group_id
    if external_chat_id and not lead.external_chat_id:
        lead.external_chat_id = external_chat_id
    if post_token and not lead.post_token:
        lead.post_token = post_token
    if not lead.source_channel:
        lead.source_channel = source_channel
    # Prefer human name over raw UUID chat id
    if body.ad_title and (not lead.name or lead.name == chat_name or lead.name == external_chat_id):
        lead.name = body.ad_title[:200]
    elif (
        chat_name
        and chat_name != external_chat_id
        and (not lead.name or lead.name == external_chat_id)
    ):
        lead.name = chat_name[:200]
    lead.last_message_at = datetime.utcnow()
    lead.updated_at = datetime.utcnow()


def _ensure_account_link(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    account_id: str,
    chat_name: str,
    external_chat_id: str | None,
) -> LeadAccountLink:
    link = (
        db.query(LeadAccountLink)
        .filter(
            LeadAccountLink.org_id == org_id,
            LeadAccountLink.lead_id == lead_id,
            LeadAccountLink.account_id == account_id,
        )
        .first()
    )
    if link:
        if external_chat_id and not link.external_chat_id:
            link.external_chat_id = external_chat_id
        if chat_name and (not link.chat_name or link.chat_name == external_chat_id):
            link.chat_name = chat_name
        db.add(link)
        return link

    # Reuse an existing chat slot (unique on org+account+chat_name / external_chat_id)
    if chat_name:
        link = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.account_id == account_id,
                LeadAccountLink.chat_name == chat_name,
            )
            .first()
        )
    else:
        link = None
    if not link and external_chat_id:
        link = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.account_id == account_id,
                LeadAccountLink.external_chat_id == external_chat_id,
            )
            .first()
        )
    if link:
        link.lead_id = lead_id
        if external_chat_id and not link.external_chat_id:
            link.external_chat_id = external_chat_id
        if chat_name:
            link.chat_name = chat_name
        db.add(link)
        return link

    link = LeadAccountLink(
        org_id=org_id,
        lead_id=lead_id,
        account_id=account_id,
        chat_name=chat_name,
        external_chat_id=external_chat_id,
    )
    db.add(link)
    return link


def _upsert_lead_from_ingest(db: Session, org_id: str, body: MessageIngestIn, acc: ChannelAccount) -> Lead:
    external_chat_id = (body.external_chat_id or "").strip() or None
    phone = (body.phone or "").strip() or None
    chat_name = (body.chat_name or body.ad_title or "").strip() or "بدون نام"
    post_token = (body.post_token or "").strip()
    source_channel = acc.channel.value if isinstance(acc.channel, ChannelType) else str(acc.channel)

    link = None
    if external_chat_id:
        link = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.account_id == body.account_id,
                LeadAccountLink.external_chat_id == external_chat_id,
            )
            .first()
        )
    if not link and chat_name:
        link = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.account_id == body.account_id,
                LeadAccountLink.chat_name == chat_name,
            )
            .first()
        )

    if link:
        lead = db.get(Lead, link.lead_id)
        if lead:
            _touch_lead_from_ingest(
                lead,
                phone=phone,
                external_chat_id=external_chat_id,
                post_token=post_token,
                source_channel=source_channel,
                body=body,
                chat_name=chat_name,
            )
            db.add(lead)
            if external_chat_id and not link.external_chat_id:
                link.external_chat_id = external_chat_id
                db.add(link)
            return lead

    lead = None
    if external_chat_id:
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.external_chat_id == external_chat_id)
            .first()
        )
    # CRM sync often saved Divar chatId as phone with empty external_chat_id
    if not lead and external_chat_id:
        lead = db.query(Lead).filter(Lead.org_id == org_id, Lead.phone == external_chat_id).first()
    if not lead and phone:
        lead = db.query(Lead).filter(Lead.org_id == org_id, Lead.phone == phone).first()
    if not lead and phone:
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.external_chat_id == phone)
            .first()
        )
    if not lead and body.group_id:
        lead = db.query(Lead).filter(Lead.org_id == org_id, Lead.group_id == body.group_id).first()
    # WhatsApp sync often stores display name only (no phone / external_chat_id yet)
    if not lead and external_chat_id and chat_name == external_chat_id:
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.name == chat_name)
            .first()
        )

    if not lead:
        display = (body.ad_title or chat_name)[:200]
        if display == external_chat_id and phone:
            display = phone[:200]
        lead = Lead(
            org_id=org_id,
            name=display,
            phone=(phone or external_chat_id or "") if body.chat_type != "group" else "",
            group_id=body.group_id if body.chat_type == "group" else "",
            external_chat_id=external_chat_id,
            post_token=post_token,
            source_channel=source_channel,
            chat_type=body.chat_type or "pv",
            last_message_at=datetime.utcnow(),
        )
        db.add(lead)
        db.flush()
    else:
        _touch_lead_from_ingest(
            lead,
            phone=phone,
            external_chat_id=external_chat_id,
            post_token=post_token,
            source_channel=source_channel,
            body=body,
            chat_name=chat_name,
        )
        db.add(lead)

    _ensure_account_link(
        db,
        org_id=org_id,
        lead_id=lead.id,
        account_id=body.account_id,
        chat_name=chat_name,
        external_chat_id=external_chat_id,
    )
    return lead


@router.post("/ingest", response_model=MessageOut)
def ingest(
    body: MessageIngestIn,
    background_tasks: BackgroundTasks,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    acc = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == body.account_id, ChannelAccount.org_id == auth.org.id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")

    lead = _upsert_lead_from_ingest(db, auth.org.id, body, acc)
    ext_msg_id = (body.external_message_id or body.wa_message_id or "").strip()

    # Deduplicate re-ingests of the same channel message
    if ext_msg_id:
        existing = (
            db.query(Message)
            .filter(
                Message.org_id == auth.org.id,
                Message.account_id == body.account_id,
                Message.wa_message_id == ext_msg_id,
            )
            .first()
        )
        if existing:
            return _to_out(existing)

    msg = Message(
        org_id=auth.org.id,
        account_id=body.account_id,
        lead_id=lead.id,
        direction=MessageDirection(body.direction),
        sender_type=SenderType(body.sender_type),
        body=body.body,
        wa_message_id=ext_msg_id,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    if body.direction == "inbound" and (body.body or "").strip() and (body.body or "").strip() != "(sync)":
        payload = {"org_id": auth.org.id, "lead_id": lead.id, "message_id": msg.id}
        # Run once in-process only (enqueue+background was causing duplicate AI replies)
        background_tasks.add_task(_run_auto_reply_job, payload)

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
    """Aggregated inbox threads across all channel accounts in the org."""
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
                    "external_chat_id": lead.external_chat_id,
                    "post_token": lead.post_token,
                    "source_channel": lead.source_channel,
                    "stage": lead.stage,
                    "assignee_id": lead.assignee_id,
                },
                "accounts": [
                    {
                        "account_id": l.account_id,
                        "chat_name": l.chat_name,
                        "external_chat_id": l.external_chat_id,
                    }
                    for l in links
                ],
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
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == body.account_id, ChannelAccount.org_id == auth.org.id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")

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
