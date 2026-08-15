from __future__ import annotations

import re
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
from app.services.bot_commands import BOT_ACK_START, ack_for_command, parse_bot_command
from app.services.reply_trace import get_trace_events, trace_event
from app.services.queue import enqueue

router = APIRouter(prefix="/messages", tags=["messages"])

_PHONE_RE = re.compile(r"^\+?\d{8,15}$")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def _looks_like_phone(value: str | None) -> bool:
    t = re.sub(r"[\s\-()]", "", str(value or ""))
    return bool(_PHONE_RE.match(t))


def _is_wa_jid(value: str | None) -> bool:
    s = str(value or "")
    return "@g.us" in s or "@c.us" in s or "@s.whatsapp.net" in s or s.endswith("@lid")


def _is_divar_style_id(value: str | None) -> bool:
    s = str(value or "").strip()
    if not s:
        return False
    if _UUID_RE.match(s):
        return True
    # Divar chat ids are often long hex / opaque tokens (not display names)
    if re.fullmatch(r"[0-9a-f]{16,}", s, re.I):
        return True
    if re.fullmatch(r"[A-Za-z0-9_-]{20,}", s) and not re.search(r"[\s\u0600-\u06FF]", s):
        return True
    return False


def _sanitize_lead_phone(
    phone: str | None,
    external_chat_id: str | None,
    *,
    chat_name: str,
    source_channel: str,
    chat_type: str,
) -> str:
    """Never store WhatsApp display names or @lid ids in Lead.phone."""
    if (chat_type or "").strip().lower() == "group":
        return ""
    ch = (source_channel or "").strip().lower()
    raw = (phone or "").strip()
    ext = (external_chat_id or "").strip()
    # Reject LID local-part stored as "phone"
    if ext.endswith("@lid") and raw:
        lid_local = ext.split("@")[0].split(":")[0]
        if raw.replace("+", "") == lid_local:
            return ""
    if raw and _looks_like_phone(raw):
        return re.sub(r"[\s\-()]", "", raw)
    if raw and ch == "divar" and raw != (chat_name or "").strip():
        return raw
    if ext and _looks_like_phone(ext):
        return re.sub(r"[\s\-()]", "", ext)
    if ext and ch == "divar" and (_is_divar_style_id(ext) or ext != (chat_name or "").strip()):
        if not _looks_like_phone(ext) and ext == (chat_name or "").strip():
            return ""
        return ext
    return ""


def _heal_display_name_phone(lead: Lead) -> None:
    """Clear phone when it is clearly a copied display name."""
    phone = (lead.phone or "").strip()
    name = (lead.name or "").strip()
    if not phone:
        return
    if _looks_like_phone(phone) or _is_wa_jid(phone) or _is_divar_style_id(phone):
        return
    if phone == name or (name and phone in name and not any(ch.isdigit() for ch in phone)):
        lead.phone = ""
    elif not any(ch.isdigit() for ch in phone) and re.search(r"[\u0600-\u06FFA-Za-z]", phone):
        # Persian/Latin label with no digits — not a phone
        lead.phone = ""


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
) -> str:
    """Queue stop/start/handoff ack immediately (not BackgroundTasks). Returns job id."""
    from app.database import SessionLocal
    from app.workers.runner import _outbound_target

    db = SessionLocal()
    try:
        lead = db.get(Lead, lead_id)
        if not lead:
            return ""
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
            return ""
        from app.services.wa_jid import resolve_target_jid

        job = OutboundJob(
            org_id=org_id,
            account_id=account_id,
            lead_id=lead_id,
            target_name=target,
            target_jid=resolve_target_jid(lead, link),
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
        try:
            from app.services.sse_hub import publish_job_ready

            publish_job_ready(account_id, job_id=job.id, reason="bot_ack", org_id=org_id)
        except Exception:  # noqa: BLE001
            pass
        return job.id
    except Exception as e:  # noqa: BLE001
        print(f"[ingest] bot_command ack error: {e}")
        return ""
    finally:
        db.close()


def _apply_bot_intent(
    *,
    lead: Lead,
    bot_cmd: str | None,
    db: Session,
) -> tuple[str, bool]:
    """
    Server-owned chat activity flag (lead.bot_paused).
    Messages are always stored by ingest; this only flips the flag + optional ack text.
      stop/handoff → paused=True  (AI skipped on later messages)
      start         → paused=False (AI allowed again)
    """
    if not bot_cmd:
        return "", False
    if bot_cmd in ("stop", "handoff"):
        was_paused = bool(lead.bot_paused)
        lead.bot_paused = True
        lead.updated_at = datetime.utcnow()
        if bot_cmd == "handoff":
            tags = list(lead.tags or [])
            if "handoff" not in tags:
                tags.append("handoff")
                lead.tags = tags
        db.add(lead)
        # Handoff: always send operator message (even if already paused via «توقف»).
        # Stop: ack only when newly pausing.
        if bot_cmd == "handoff":
            return ack_for_command(bot_cmd), True
        if not was_paused:
            return ack_for_command(bot_cmd), True
        return "", False
    if bot_cmd == "start":
        was_paused = bool(lead.bot_paused)
        lead.bot_paused = False
        lead.updated_at = datetime.utcnow()
        db.add(lead)
        if was_paused:
            return BOT_ACK_START, True
        return "", False
    return "", False


def _dispatch_inbound_actions(
    *,
    org_id: str,
    lead: Lead,
    msg: Message,
    body: MessageIngestIn,
    body_text: str,
    bot_cmd: str | None,
    ack_text: str,
    trace_id: str,
    background_tasks: BackgroundTasks | None,
) -> dict | None:
    """
    Central post-save handler:
      1) stop/start/handoff → queue ack only (AI not run on the command itself)
      2) normal inbound → auto-reply if chat active (bot_paused=False)
    """
    chat_name = (body.chat_name or lead.name or "").strip()
    if bot_cmd and ack_text:
        ack_job_id = _queue_bot_command_ack(
            org_id=org_id,
            account_id=body.account_id,
            lead_id=lead.id,
            target_name=chat_name,
            body=ack_text,
        )
        trace_event(trace_id, "bot_command_ack", command=bot_cmd, job_id=ack_job_id)
        return {"status": "queued", "reason": f"bot_{bot_cmd}", "job_id": ack_job_id}
    if bot_cmd in ("stop", "handoff", "start"):
        trace_event(trace_id, "bot_command_noop", command=bot_cmd, paused=lead.bot_paused)
        return {"status": "skipped", "reason": f"bot_{bot_cmd}_noop", "job_id": ""}
    return _maybe_auto_reply(
        org_id=org_id,
        lead=lead,
        msg=msg,
        body_text=body_text,
        direction=body.direction,
        trace_id=trace_id,
        background_tasks=background_tasks,
    )


def process_message_ingest(
    *,
    db: Session,
    org_id: str,
    body: MessageIngestIn,
    acc: ChannelAccount,
    background_tasks: BackgroundTasks | None = None,
) -> MessageIngestOut:
    """
    Incoming message handler (shared by extension + Baileys connector).

    Always persists inbound text. Then decides purpose:
      - stop/handoff → set lead.bot_paused=True, optional ack, no AI
      - start        → set lead.bot_paused=False, ack, no AI on this message
      - other        → if not paused, run AI auto-reply pipeline
    Pause never rejects ingest — history keeps flowing for the next actions.
    """
    trace_id = (body.trace_id or "").strip()
    trace_event(
        trace_id,
        "ingest_received",
        chat=body.chat_name,
        direction=body.direction,
    )

    lead = _upsert_lead_from_ingest(db, org_id, body, acc)
    ext_msg_id = (body.external_message_id or body.wa_message_id or "").strip()
    body_text = (body.body or "").strip()
    bot_cmd = (
        parse_bot_command(body_text)
        if body.direction == "inbound" and body_text and body_text != "(sync)"
        else None
    )

    # Never treat stop/start/handoff as echo of our outbound — resume must always apply.
    if body.direction == "inbound" and body_text and not bot_cmd:
        echo = (
            db.query(Message)
            .filter(
                Message.org_id == org_id,
                Message.lead_id == lead.id,
                Message.direction == MessageDirection.outbound,
                Message.body == body_text,
            )
            .order_by(Message.created_at.desc())
            .first()
        )
        if echo:
            trace_event(trace_id, "ingest_skipped_echo", lead_id=lead.id)
            return _to_ingest_out(echo, trace_id=trace_id, bot_paused=lead.bot_paused)

    # Deduplicate re-ingests of the same channel message — but still run handler
    # (intent / auto-reply) if the first attempt did not finish.
    if ext_msg_id:
        existing = (
            db.query(Message)
            .filter(
                Message.org_id == org_id,
                Message.account_id == body.account_id,
                Message.wa_message_id == ext_msg_id,
            )
            .first()
        )
        if existing:
            trace_event(trace_id, "ingest_deduped", message_id=existing.id)
            ack_text, _changed = _apply_bot_intent(lead=lead, bot_cmd=bot_cmd, db=db)
            if bot_cmd:
                db.commit()
            auto_reply = _dispatch_inbound_actions(
                org_id=org_id,
                lead=lead,
                msg=existing,
                body=body,
                body_text=body_text,
                bot_cmd=bot_cmd,
                ack_text=ack_text,
                trace_id=trace_id,
                background_tasks=background_tasks,
            )
            return _to_ingest_out(
                existing,
                trace_id=trace_id,
                auto_reply=auto_reply,
                bot_paused=lead.bot_paused,
                bot_command=bot_cmd or "",
            )

    msg = Message(
        org_id=org_id,
        account_id=body.account_id,
        lead_id=lead.id,
        direction=MessageDirection(body.direction),
        sender_type=SenderType(body.sender_type),
        body=body.body,
        wa_message_id=ext_msg_id,
        media_type=(getattr(body, "media_type", None) or "").strip(),
        media_url=(getattr(body, "media_url", None) or "").strip(),
        delivery_status="sent" if body.direction == "outbound" else "",
    )
    db.add(msg)

    ack_text, _changed = _apply_bot_intent(lead=lead, bot_cmd=bot_cmd, db=db)

    db.commit()
    db.refresh(msg)
    trace_event(trace_id, "message_saved", message_id=msg.id, lead_id=lead.id)
    if bot_cmd:
        trace_event(
            trace_id,
            "bot_intent_applied",
            command=bot_cmd,
            bot_paused=lead.bot_paused,
            ack=bool(ack_text),
        )

    auto_reply = _dispatch_inbound_actions(
        org_id=org_id,
        lead=lead,
        msg=msg,
        body=body,
        body_text=body_text,
        bot_cmd=bot_cmd,
        ack_text=ack_text,
        trace_id=trace_id,
        background_tasks=background_tasks,
    )

    return _to_ingest_out(
        msg,
        trace_id=trace_id,
        auto_reply=auto_reply,
        bot_paused=lead.bot_paused,
        bot_command=bot_cmd or "",
    )


@router.post("/ingest", response_model=MessageIngestOut)
def ingest(
    body: MessageIngestIn,
    background_tasks: BackgroundTasks,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    from app.services.ingest_service import process_message_ingest as shared_ingest

    return shared_ingest(
        db,
        auth.org.id,
        body,
        background_tasks,
        allow_baileys_extension=False,
    )


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
        media_type=getattr(m, "media_type", "") or "",
        media_url=getattr(m, "media_url", "") or "",
        delivery_status=getattr(m, "delivery_status", "") or "",
        wa_message_id=getattr(m, "wa_message_id", "") or "",
    )


def _to_ingest_out(
    m: Message,
    *,
    trace_id: str = "",
    auto_reply: dict | None = None,
    bot_paused: bool | None = None,
    bot_command: str = "",
) -> MessageIngestOut:
    ar = auto_reply or {}
    base = _to_out(m)
    return MessageIngestOut(
        **base.model_dump(),
        trace_id=trace_id,
        auto_reply_status=str(ar.get("status") or ""),
        auto_reply_reason=str(ar.get("reason") or ""),
        job_id=str(ar.get("job_id") or ""),
        bot_paused=bot_paused,
        bot_command=bot_command or "",
    )


def _ingest_is_group(body: MessageIngestIn, external_chat_id: str | None) -> bool:
    body_type = (body.chat_type or "").strip().lower()
    ext = (external_chat_id or "").strip()
    return (
        body_type == "group"
        or bool((body.group_id or "").strip())
        or ext.endswith("@g.us")
        or ext.startswith("gname:")
    )


def _lead_is_group(lead: Lead) -> bool:
    ct = (lead.chat_type or "").strip().lower()
    if ct == "group":
        return True
    gid = (lead.group_id or "").strip()
    ext = (lead.external_chat_id or "").strip()
    return gid.endswith("@g.us") or ext.endswith("@g.us") or ext.startswith("gname:")


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
    ingest_group = _ingest_is_group(body, external_chat_id)
    lead_group = _lead_is_group(lead)

    # Never convert a private lead into a group (or the reverse) via touch —
    # wrong matches used to flip PV contacts when someone spoke in a group.
    if ingest_group and not lead_group:
        # Only allow fill of missing metadata if this lead is clearly the same group id
        same_group = False
        gid = (body.group_id or external_chat_id or "").strip()
        if gid and (
            (lead.group_id or "").strip() == gid
            or (lead.external_chat_id or "").strip() == gid
        ):
            same_group = True
        if not same_group:
            lead.last_message_at = datetime.utcnow()
            lead.updated_at = datetime.utcnow()
            return
    if (not ingest_group) and lead_group:
        lead.last_message_at = datetime.utcnow()
        lead.updated_at = datetime.utcnow()
        return

    inferred_type = "group" if ingest_group else ((body.chat_type or lead.chat_type or "pv").strip().lower() or "pv")

    safe_phone = _sanitize_lead_phone(
        phone,
        external_chat_id,
        chat_name=chat_name,
        source_channel=source_channel,
        chat_type=inferred_type,
    )
    if not ingest_group:
        if safe_phone and not _looks_like_phone(lead.phone or "") and not _is_divar_style_id(lead.phone or ""):
            lead.phone = safe_phone
        elif safe_phone and not lead.phone:
            lead.phone = safe_phone

    if ingest_group:
        lead.chat_type = "group"
        if body.group_id:
            lead.group_id = body.group_id
        elif (external_chat_id or "").endswith("@g.us"):
            lead.group_id = external_chat_id or lead.group_id
        # Groups must not keep a display-name phone
        if lead.phone and not _looks_like_phone(lead.phone):
            lead.phone = ""
        # Prefer human group title when chat_name is not the raw jid
        if (
            chat_name
            and chat_name != external_chat_id
            and not chat_name.endswith("@g.us")
            and (not lead.name or lead.name == external_chat_id or (lead.name or "").endswith("@g.us"))
        ):
            lead.name = chat_name[:200]
    else:
        if not lead.chat_type or lead.chat_type == "group":
            # Do not demote an established group here; guarded above
            lead.chat_type = "pv"

    if external_chat_id and not lead.external_chat_id:
        # Avoid locking display names into external_chat_id when we have a better id later
        if not (
            external_chat_id == chat_name
            and not _looks_like_phone(external_chat_id)
            and not _is_wa_jid(external_chat_id)
            and not str(external_chat_id).startswith("gname:")
            and (source_channel or "").lower() == "whatsapp"
        ):
            lead.external_chat_id = external_chat_id
    if post_token and not lead.post_token:
        lead.post_token = post_token
    if not lead.source_channel:
        lead.source_channel = source_channel
    if not ingest_group:
        # Prefer human name over raw UUID chat id
        if body.ad_title and (not lead.name or lead.name == chat_name or lead.name == external_chat_id):
            lead.name = body.ad_title[:200]
        elif (
            chat_name
            and chat_name != external_chat_id
            and (
                not lead.name
                or lead.name == external_chat_id
                or (lead.name or "").endswith("@lid")
                or (lead.name or "").endswith("@s.whatsapp.net")
            )
        ):
            lead.name = chat_name[:200]
        _heal_display_name_phone(lead)
    lead.last_message_at = datetime.utcnow()
    lead.updated_at = datetime.utcnow()


def _ext_id_taken(
    db: Session,
    *,
    org_id: str,
    account_id: str,
    external_chat_id: str,
    exclude_link_id: str | None = None,
) -> LeadAccountLink | None:
    q = db.query(LeadAccountLink).filter(
        LeadAccountLink.org_id == org_id,
        LeadAccountLink.account_id == account_id,
        LeadAccountLink.external_chat_id == external_chat_id,
    )
    if exclude_link_id:
        q = q.filter(LeadAccountLink.id != exclude_link_id)
    return q.first()


def _chat_name_taken(
    db: Session,
    *,
    org_id: str,
    account_id: str,
    chat_name: str,
    exclude_link_id: str | None = None,
) -> LeadAccountLink | None:
    q = db.query(LeadAccountLink).filter(
        LeadAccountLink.org_id == org_id,
        LeadAccountLink.account_id == account_id,
        LeadAccountLink.chat_name == chat_name,
    )
    if exclude_link_id:
        q = q.filter(LeadAccountLink.id != exclude_link_id)
    return q.first()


def _safe_fill_link_ids(
    db: Session,
    link: LeadAccountLink,
    *,
    org_id: str,
    account_id: str,
    chat_name: str,
    external_chat_id: str | None,
) -> None:
    """Fill missing link fields without violating UNIQUE(org, account, chat/ext)."""
    ext = (external_chat_id or "").strip() or None
    name = (chat_name or "").strip()
    if ext and not (link.external_chat_id or "").strip():
        if not _ext_id_taken(
            db, org_id=org_id, account_id=account_id, external_chat_id=ext, exclude_link_id=link.id
        ):
            link.external_chat_id = ext
    if name and (not (link.chat_name or "").strip() or link.chat_name == (link.external_chat_id or "")):
        if not _chat_name_taken(
            db, org_id=org_id, account_id=account_id, chat_name=name, exclude_link_id=link.id
        ):
            link.chat_name = name
    db.add(link)


def _ensure_account_link(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    account_id: str,
    chat_name: str,
    external_chat_id: str | None,
) -> LeadAccountLink:
    """
    Attach lead ↔ channel account. Reuse unique chat/ext slots instead of inserting
    duplicates (avoids IntegrityError that used to abort auto-reply).
    """
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
        _safe_fill_link_ids(
            db,
            link,
            org_id=org_id,
            account_id=account_id,
            chat_name=chat_name,
            external_chat_id=external_chat_id,
        )
        return link

    # Reuse an existing chat slot (unique on org+account+chat_name / external_chat_id)
    if chat_name:
        link = _chat_name_taken(db, org_id=org_id, account_id=account_id, chat_name=chat_name)
    else:
        link = None
    if not link and external_chat_id:
        link = _ext_id_taken(
            db, org_id=org_id, account_id=account_id, external_chat_id=external_chat_id
        )
    if link:
        link.lead_id = lead_id
        _safe_fill_link_ids(
            db,
            link,
            org_id=org_id,
            account_id=account_id,
            chat_name=chat_name,
            external_chat_id=external_chat_id,
        )
        return link

    # Avoid unique clash: omit fields already owned by another row
    safe_ext = external_chat_id
    safe_name = chat_name or ""
    if safe_ext and _ext_id_taken(db, org_id=org_id, account_id=account_id, external_chat_id=safe_ext):
        safe_ext = None
    if safe_name and _chat_name_taken(db, org_id=org_id, account_id=account_id, chat_name=safe_name):
        safe_name = f"{safe_name}·{lead_id[:8]}"

    link = LeadAccountLink(
        org_id=org_id,
        lead_id=lead_id,
        account_id=account_id,
        chat_name=safe_name,
        external_chat_id=safe_ext,
    )
    db.add(link)
    return link


def _upsert_lead_from_ingest(db: Session, org_id: str, body: MessageIngestIn, acc: ChannelAccount) -> Lead:
    from app.services.lead_identity import (
        apply_wa_identity,
        find_wa_identity_candidates,
        is_lid_jid,
        merge_lead_into,
        normalize_lid,
        pick_winner,
        prefer_pn_external,
    )

    external_chat_id = (body.external_chat_id or "").strip() or None
    phone = (body.phone or "").strip() or None
    chat_name = (body.chat_name or body.ad_title or "").strip() or "بدون نام"
    post_token = (body.post_token or "").strip()
    source_channel = acc.channel.value if isinstance(acc.channel, ChannelType) else str(acc.channel)
    ingest_group = _ingest_is_group(body, external_chat_id)
    wa_lid = normalize_lid(getattr(body, "wa_lid", None) or "")
    if not wa_lid and external_chat_id and is_lid_jid(external_chat_id):
        wa_lid = normalize_lid(external_chat_id)

    # WhatsApp must not use display name as external id / phone
    if (
        source_channel == "whatsapp"
        and external_chat_id
        and external_chat_id == chat_name
        and not _looks_like_phone(external_chat_id)
        and not _is_wa_jid(external_chat_id)
    ):
        external_chat_id = None
    if phone and not _looks_like_phone(phone) and source_channel == "whatsapp":
        phone = None
    # Group messages never carry the sender phone into lead.phone matching
    if ingest_group:
        phone = None
        wa_lid = ""
    else:
        # Prefer stable PN jid as external_chat_id when phone is known
        preferred = prefer_pn_external(phone, external_chat_id, wa_lid or None)
        if preferred:
            external_chat_id = preferred

    def _link_lead_ok(link_row: LeadAccountLink) -> Lead | None:
        lead_row = db.get(Lead, link_row.lead_id)
        if not lead_row:
            return None
        # Isolate PV ↔ group: never reuse the wrong chat type
        if ingest_group and not _lead_is_group(lead_row):
            return None
        if (not ingest_group) and _lead_is_group(lead_row):
            return None
        return lead_row

    def _find_link_by_ext(ext: str | None) -> LeadAccountLink | None:
        if not ext:
            return None
        return (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.account_id == body.account_id,
                LeadAccountLink.external_chat_id == ext,
            )
            .first()
        )

    link = _find_link_by_ext(external_chat_id)
    # Also match legacy LID-keyed links when ingest now carries PN + lid
    if not link and wa_lid and wa_lid != external_chat_id:
        link = _find_link_by_ext(wa_lid)
    # For groups, do NOT fall back to chat_name (often was sender pushName historically).
    # For PV, chat_name match is OK only against non-group leads.
    if not link and chat_name and not ingest_group:
        candidates = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.account_id == body.account_id,
                LeadAccountLink.chat_name == chat_name,
            )
            .all()
        )
        for cand in candidates:
            if _link_lead_ok(cand):
                link = cand
                break

    lead: Lead | None = None
    if link:
        lead = _link_lead_ok(link)

    if ingest_group:
        if not lead and external_chat_id:
            cand = (
                db.query(Lead)
                .filter(Lead.org_id == org_id, Lead.external_chat_id == external_chat_id)
                .first()
            )
            if cand and _lead_is_group(cand):
                lead = cand
        if not lead and body.group_id:
            lead = (
                db.query(Lead)
                .filter(
                    Lead.org_id == org_id,
                    Lead.group_id == body.group_id,
                    Lead.chat_type == "group",
                )
                .first()
            )
        if not lead and external_chat_id and external_chat_id.endswith("@g.us"):
            lead = (
                db.query(Lead)
                .filter(
                    Lead.org_id == org_id,
                    Lead.group_id == external_chat_id,
                    Lead.chat_type == "group",
                )
                .first()
            )
    else:
        # Collect all LID/PN/phone matches and merge duplicates into one lead
        id_cands = find_wa_identity_candidates(
            db,
            org_id=org_id,
            external_chat_id=external_chat_id,
            phone=phone,
            wa_lid=wa_lid or None,
        )
        by_id: dict[str, Lead] = {c.id: c for c in id_cands}
        if lead:
            by_id[lead.id] = lead
        # Name match only for PV, and only when name isn't a raw jid
        if (
            not by_id
            and chat_name
            and chat_name != external_chat_id
            and not chat_name.endswith("@g.us")
            and not chat_name.endswith("@lid")
            and not chat_name.endswith("@s.whatsapp.net")
        ):
            cand = (
                db.query(Lead)
                .filter(Lead.org_id == org_id, Lead.name == chat_name)
                .first()
            )
            if cand and not _lead_is_group(cand):
                by_id[cand.id] = cand

        members = list(by_id.values())
        if len(members) > 1:
            winner = pick_winner(db, members)
            for m in members:
                if m.id != winner.id:
                    merge_lead_into(db, winner=winner, loser=m)
            lead = winner
            # Re-fetch link after merge (loser links may have moved)
            link = _find_link_by_ext(external_chat_id) or _find_link_by_ext(wa_lid) or link
        elif len(members) == 1:
            lead = members[0]

    if not lead:
        display = (body.ad_title or chat_name)[:200]
        if display == external_chat_id and phone:
            display = phone[:200]
        if display.endswith("@lid") and phone:
            display = phone[:200]
        if ingest_group and (display.endswith("@g.us") or display == external_chat_id):
            # Keep jid as placeholder name until a human title is known
            display = (external_chat_id or chat_name or "گروه")[:200]
        inferred_type = "group" if ingest_group else "pv"
        phone_val = ""
        if not ingest_group:
            phone_val = _sanitize_lead_phone(
                phone,
                external_chat_id,
                chat_name=chat_name,
                source_channel=source_channel,
                chat_type=inferred_type,
            )
        lead = Lead(
            org_id=org_id,
            name=display,
            phone=phone_val,
            group_id=(body.group_id or (external_chat_id if (external_chat_id or "").endswith("@g.us") else "") or "")
            if inferred_type == "group"
            else "",
            external_chat_id=external_chat_id,
            wa_lid=wa_lid or "",
            post_token=post_token,
            source_channel=source_channel,
            chat_type=inferred_type,
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
        if not ingest_group:
            apply_wa_identity(
                lead,
                phone=phone,
                external_chat_id=external_chat_id,
                wa_lid=wa_lid or None,
                chat_name=chat_name,
            )
        db.add(lead)

    # Link chat_name for groups should be stable (jid or title), not sender name
    link_chat_name = chat_name
    if ingest_group and external_chat_id:
        link_chat_name = external_chat_id

    # Prefer PN on the account link; upgrade legacy @lid link ids in place
    link_ext = external_chat_id
    if not ingest_group and link and wa_lid and (link.external_chat_id or "") == wa_lid:
        if external_chat_id and not is_lid_jid(external_chat_id):
            taken = _ext_id_taken(
                db,
                org_id=org_id,
                account_id=body.account_id,
                external_chat_id=external_chat_id,
                exclude_link_id=link.id,
            )
            if not taken:
                link.external_chat_id = external_chat_id
                db.add(link)
                link_ext = external_chat_id

    _ensure_account_link(
        db,
        org_id=org_id,
        lead_id=lead.id,
        account_id=body.account_id,
        chat_name=link_chat_name,
        external_chat_id=link_ext,
    )
    return lead


def _maybe_auto_reply(
    *,
    org_id: str,
    lead: Lead,
    msg: Message,
    body_text: str,
    direction: str,
    trace_id: str,
    background_tasks: BackgroundTasks | None = None,
) -> dict | None:
    """Run sync auto-reply for inbound text; returns status dict or None if not applicable."""
    if direction != "inbound" or not body_text or body_text == "(sync)":
        return None
    bot_cmd = parse_bot_command(body_text)
    if bot_cmd:
        return None

    enrich_payload = {
        "org_id": org_id,
        "lead_id": lead.id,
        "message_id": msg.id,
        "body": body_text,
    }
    enqueue("lead_enrich", enrich_payload)
    if background_tasks is not None:
        def _run_enrich() -> None:
            try:
                from app.workers.runner import handle_lead_enrich

                handle_lead_enrich(enrich_payload)
            except Exception:  # noqa: BLE001
                pass

        background_tasks.add_task(_run_enrich)

    payload = {
        "org_id": org_id,
        "lead_id": lead.id,
        "message_id": msg.id,
        "trace_id": trace_id,
        "chat_type": (lead.chat_type or "pv"),
        "group_id": (lead.group_id or ""),
        "external_chat_id": (lead.external_chat_id or ""),
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
    try:
        from app.database import SessionLocal
        from app.services.follow_up_seq import (
            mark_follow_up_plan,
            schedule_follow_up,
            should_schedule_after_auto_reply,
        )

        if should_schedule_after_auto_reply(auto_reply):
            planned = schedule_follow_up(
                org_id=org_id,
                lead_id=lead.id,
                trigger_message_id=msg.id,
                step=0,
                reason=str((auto_reply or {}).get("reason") or "no_reply"),
            )
            if planned:
                db = SessionLocal()
                try:
                    row = db.get(Lead, lead.id)
                    if row:
                        mark_follow_up_plan(row, planned, status="scheduled")
                        db.add(row)
                        db.commit()
                        lead.ai_meta = row.ai_meta
                finally:
                    db.close()
    except Exception:  # noqa: BLE001
        pass
    return auto_reply


@router.get("/trace/{trace_id}")
def get_reply_trace(
    trace_id: str,
    since: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth),
):
    _ = auth
    events = get_trace_events(trace_id, since=since)
    return {"trace_id": trace_id, "since": since, "events": events}


@router.get("/presence")
def get_chat_presence(
    lead_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    """Typing / recording state for an open inbox thread."""
    from app.services.chat_presence import get_presence

    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == auth.org.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="لید یافت نشد")
    return get_presence(org_id=auth.org.id, lead_id=lead.id)


def _wa_link_and_jid(
    *,
    db: Session,
    org_id: str,
    lead_id: str,
    account_id: str | None = None,
) -> tuple[Lead, ChannelAccount, LeadAccountLink | None, str]:
    from app.services.wa_jid import resolve_target_jid

    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == org_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="لید یافت نشد")

    links = (
        db.query(LeadAccountLink)
        .filter(LeadAccountLink.org_id == org_id, LeadAccountLink.lead_id == lead.id)
        .all()
    )
    acc: ChannelAccount | None = None
    link: LeadAccountLink | None = None
    if account_id:
        acc = (
            db.query(ChannelAccount)
            .filter(ChannelAccount.id == account_id, ChannelAccount.org_id == org_id)
            .first()
        )
        link = next((x for x in links if x.account_id == account_id), None)
    if not acc:
        for x in links:
            cand = db.get(ChannelAccount, x.account_id)
            if cand and (cand.connector_type or "baileys") == "baileys":
                acc = cand
                link = x
                break
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت واتساپ یافت نشد")

    jid = resolve_target_jid(lead, link)
    if not jid:
        raise HTTPException(status_code=400, detail="شناسه چت واتساپ موجود نیست")
    return lead, acc, link, jid


def _connector_presence(account_id: str, *, action: str, jid: str = "") -> dict:
    import httpx

    try:
        r = httpx.post(
            f"http://127.0.0.1:8090/presence/{account_id}",
            json={"action": action, "jid": jid},
            timeout=5.0,
        )
        if r.status_code >= 400:
            return {"ok": False, "error": r.text}
        return r.json() if r.content else {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@router.post("/presence/subscribe")
def subscribe_chat_presence(
    body: dict,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    """Ask Baileys to subscribe to presence updates for this lead's chat."""
    lead_id = str(body.get("lead_id") or "").strip()
    account_id = str(body.get("account_id") or "").strip() or None
    if not lead_id:
        raise HTTPException(status_code=400, detail="lead_id لازم است")
    _, acc, _, jid = _wa_link_and_jid(
        db=db, org_id=auth.org.id, lead_id=lead_id, account_id=account_id
    )
    result = _connector_presence(acc.id, action="subscribe", jid=jid)
    return {"ok": bool(result.get("ok", True)), "jid": jid, "connector": result}


@router.post("/typing")
def broadcast_typing(
    body: dict,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    """Broadcast composing / paused / recording to WhatsApp for an open inbox thread."""
    lead_id = str(body.get("lead_id") or "").strip()
    account_id = str(body.get("account_id") or "").strip() or None
    state = str(body.get("state") or body.get("action") or "composing").strip().lower()
    if not lead_id:
        raise HTTPException(status_code=400, detail="lead_id لازم است")
    if state not in ("composing", "recording", "paused", "available", "unavailable"):
        raise HTTPException(status_code=400, detail="state نامعتبر")
    _, acc, _, jid = _wa_link_and_jid(
        db=db, org_id=auth.org.id, lead_id=lead_id, account_id=account_id
    )
    result = _connector_presence(acc.id, action=state, jid=jid)
    return {"ok": bool(result.get("ok", True)), "state": state, "jid": jid, "connector": result}


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
                    "tags": lead.tags or [],
                    "lead_score": float(getattr(lead, "lead_score", 0) or 0),
                    "ai_meta": dict(getattr(lead, "ai_meta", None) or {}),
                    "bot_paused": bool(lead.bot_paused),
                    "notes": lead.notes or "",
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

    from app.services.wa_jid import resolve_target_jid

    link = None
    lead = None
    if body.lead_id:
        lead = db.query(Lead).filter(Lead.id == body.lead_id, Lead.org_id == auth.org.id).first()
        if lead:
            link = (
                db.query(LeadAccountLink)
                .filter(
                    LeadAccountLink.org_id == auth.org.id,
                    LeadAccountLink.lead_id == lead.id,
                    LeadAccountLink.account_id == body.account_id,
                )
                .first()
            )

    target_jid = resolve_target_jid(lead, link)
    job = OutboundJob(
        org_id=auth.org.id,
        account_id=body.account_id,
        lead_id=body.lead_id,
        target_name=body.target_name,
        target_jid=target_jid,
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
                delivery_status="pending",
            )
        )

    db.commit()
    db.refresh(job)
    try:
        from app.services.sse_hub import publish_job_ready

        publish_job_ready(
            body.account_id, job_id=job.id, reason="manual_send", org_id=auth.org.id
        )
    except Exception:  # noqa: BLE001
        pass
    enqueue("outbound_send", {"job_id": job.id, "org_id": auth.org.id})
    return OutboundJobOut(
        id=job.id,
        account_id=job.account_id,
        lead_id=job.lead_id,
        target_name=job.target_name,
        body=job.body,
        sender_type=job.sender_type.value,
        status=job.status.value,
        target_jid=getattr(job, "target_jid", "") or "",
    )
