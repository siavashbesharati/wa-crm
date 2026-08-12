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
from app.schemas import MessageIngestIn, MessageIngestOut, MessageOut, OutboundJobOut, SendMessageIn
from app.services.bot_commands import BOT_ACK_START, BOT_ACK_STOP, parse_bot_command
from app.services.reply_trace import get_trace_events, trace_event
from app.services.queue import enqueue

router = APIRouter(prefix="/messages", tags=["messages"])


def _run_auto_reply_job(payload: dict) -> dict:
    """Process auto_reply in-process so job is queued before ingest response."""
    try:
        from app.workers.runner import handle_auto_reply

        return handle_auto_reply(payload)
    except Exception as e:  # noqa: BLE001
        trace_event(str(payload.get("trace_id") or ""), "auto_reply_error", error=str(e))
        print(f"[ingest] auto_reply error: {e}")
        return {"status": "error", "reason": str(e), "job_id": ""}


def _queue_bot_command_ack(
    *,
    org_id: str,
    account_id: str,
    lead_id: str,
    target_name: str,
    body: str,
) -> None:
    """Send a short system ack after stop/start — not AI."""
    from app.database import SessionLocal
    from app.workers.runner import _outbound_target

    db = SessionLocal()
    try:
        lead = db.get(Lead, lead_id)
        if not lead:
            return
        link = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.lead_id == lead_id,
                LeadAccountLink.account_id == account_id,
            )
            .first()
        )
        target = (target_name or "").strip() or _outbound_target(lead, link)
        if not target:
            return
        job = OutboundJob(
            org_id=org_id,
            account_id=account_id,
            lead_id=lead_id,
            target_name=target,
            body=body,
            sender_type=SenderType.system,
            status=OutboundStatus.queued,
        )
        db.add(job)
        db.add(
            Message(
                org_id=org_id,
                account_id=account_id,
                lead_id=lead_id,
                direction=MessageDirection.outbound,
                sender_type=SenderType.system,
                body=body,
            )
        )
        db.commit()
        print(f"[ingest] bot_command ack queued job={job.id} lead={lead_id}")
    except Exception as e:  # noqa: BLE001
        print(f"[ingest] bot_command ack error: {e}")
    finally:
        db.close()


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


def _to_ingest_out(
    m: Message,
    *,
    trace_id: str = "",
    auto_reply: dict | None = None,
) -> MessageIngestOut:
    ar = auto_reply or {}
    base = _to_out(m)
    return MessageIngestOut(
        **base.model_dump(),
        trace_id=trace_id,
        auto_reply_status=str(ar.get("status") or ""),
        auto_reply_reason=str(ar.get("reason") or ""),
        job_id=str(ar.get("job_id") or ""),
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


def _maybe_auto_reply(
    *,
    auth: AuthContext,
    lead: Lead,
    msg: Message,
    body_text: str,
    direction: str,
    trace_id: str,
    background_tasks: BackgroundTasks | None = None,
) -> dict | None:
    """Run sync auto-reply for inbound text; returns status dict or None if not applicable."""
    _ = background_tasks
    if direction != "inbound" or not body_text or body_text == "(sync)":
        return None
    bot_cmd = parse_bot_command(body_text)
    if bot_cmd:
        return None
    payload = {
        "org_id": auth.org.id,
        "lead_id": lead.id,
        "message_id": msg.id,
        "trace_id": trace_id,
    }
    trace_event(trace_id, "auto_reply_scheduled", message_id=msg.id)
    auto_reply = _run_auto_reply_job(payload)
    trace_event(
        trace_id,
        "auto_reply_finished",
        status=(auto_reply or {}).get("status"),
        reason=(auto_reply or {}).get("reason"),
        job_id=(auto_reply or {}).get("job_id"),
    )
    return auto_reply


@router.post("/ingest", response_model=MessageIngestOut)
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

    trace_id = (body.trace_id or "").strip()
    trace_event(
        trace_id,
        "ingest_received",
        chat=body.chat_name,
        direction=body.direction,
    )

    lead = _upsert_lead_from_ingest(db, auth.org.id, body, acc)
    ext_msg_id = (body.external_message_id or body.wa_message_id or "").strip()
    body_text = (body.body or "").strip()

    # Extension sometimes mis-reads our own outbound bubble as inbound
    if body.direction == "inbound" and body_text:
        echo = (
            db.query(Message)
            .filter(
                Message.org_id == auth.org.id,
                Message.lead_id == lead.id,
                Message.direction == MessageDirection.outbound,
                Message.body == body_text,
            )
            .order_by(Message.created_at.desc())
            .first()
        )
        if echo:
            trace_event(trace_id, "ingest_skipped_echo", lead_id=lead.id)
            return _to_ingest_out(echo, trace_id=trace_id)

    # Deduplicate re-ingests of the same channel message — but still try auto-reply
    # if the first attempt crashed / never queued a job.
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
            trace_event(trace_id, "ingest_deduped", message_id=existing.id)
            auto_reply = _maybe_auto_reply(
                auth=auth,
                lead=lead,
                msg=existing,
                body_text=body_text,
                direction=body.direction,
                trace_id=trace_id,
                background_tasks=background_tasks,
            )
            return _to_ingest_out(existing, trace_id=trace_id, auto_reply=auto_reply)

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

    bot_cmd = (
        parse_bot_command(body_text)
        if body.direction == "inbound" and body_text and body_text != "(sync)"
        else None
    )
    ack_text = ""
    if bot_cmd == "stop":
        if not lead.bot_paused:
            lead.bot_paused = True
            lead.updated_at = datetime.utcnow()
            db.add(lead)
            ack_text = BOT_ACK_STOP
    elif bot_cmd == "start":
        if lead.bot_paused:
            lead.bot_paused = False
            lead.updated_at = datetime.utcnow()
            db.add(lead)
            ack_text = BOT_ACK_START

    db.commit()
    db.refresh(msg)
    trace_event(trace_id, "message_saved", message_id=msg.id, lead_id=lead.id)

    chat_name = (body.chat_name or lead.name or "").strip()
    auto_reply: dict | None = None
    if bot_cmd and ack_text:
        trace_event(trace_id, "bot_command_ack", command=bot_cmd)
        background_tasks.add_task(
            _queue_bot_command_ack,
            org_id=auth.org.id,
            account_id=body.account_id,
            lead_id=lead.id,
            target_name=chat_name,
            body=ack_text,
        )
    else:
        auto_reply = _maybe_auto_reply(
            auth=auth,
            lead=lead,
            msg=msg,
            body_text=body_text,
            direction=body.direction,
            trace_id=trace_id,
            background_tasks=background_tasks,
        )

    return _to_ingest_out(msg, trace_id=trace_id, auto_reply=auto_reply)


@router.get("/trace/{trace_id}")
def get_reply_trace(
    trace_id: str,
    since: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth),
):
    _ = auth
    events = get_trace_events(trace_id, since=since)
    return {"trace_id": trace_id, "since": since, "events": events}


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
