from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    AutomationRule,
    AutomationRun,
    ChannelAccount,
    InstagramEvent,
    Lead,
    LeadAccountLink,
    OutboundJob,
    SenderType,
)
from app.schemas import InstagramEventIn, MessageIngestIn


def _author(event: InstagramEvent) -> dict[str, Any]:
    return event.author_json if isinstance(event.author_json, dict) else {}


def _upsert_lead(db: Session, event: InstagramEvent, account: ChannelAccount) -> Lead | None:
    author_id = (event.external_author_id or "").strip()
    if not author_id:
        return None
    external_id = f"instagram:user:{author_id}"
    link = (
        db.query(LeadAccountLink)
        .filter(
            LeadAccountLink.org_id == account.org_id,
            LeadAccountLink.account_id == account.id,
            LeadAccountLink.external_chat_id == external_id,
        )
        .first()
    )
    author = _author(event)
    if link:
        lead = db.get(Lead, link.lead_id)
    else:
        lead = Lead(
            org_id=account.org_id,
            name=str(author.get("full_name") or author.get("username") or external_id),
            external_chat_id=external_id,
            source_channel="instagram",
            chat_type="pv",
        )
        db.add(lead)
        db.flush()
        link = LeadAccountLink(
            org_id=account.org_id,
            lead_id=lead.id,
            account_id=account.id,
            chat_name=lead.name,
            external_chat_id=external_id,
        )
        db.add(link)
    if lead and author.get("full_name") and not lead.name:
        lead.name = str(author["full_name"])
    if lead:
        event.lead_id = lead.id
        db.add(event)
    return lead


def _condition_matches(event: InstagramEvent, condition: dict[str, Any]) -> bool:
    kind = str(condition.get("type") or condition.get("operator") or "").strip().lower()
    if kind in ("contains", "keyword", "text_contains"):
        value = str(condition.get("value") or condition.get("keyword") or "").casefold()
        return bool(value) and value in (event.body or "").casefold()
    if kind in ("event_type", "type_is"):
        return str(condition.get("value") or "").casefold() == event.event_type.casefold()
    return False


def _queue_outbound(
    db: Session,
    *,
    account: ChannelAccount,
    lead: Lead | None,
    body: str,
    target: str,
    sender_type: SenderType = SenderType.ai,
) -> str:
    job = OutboundJob(
        org_id=account.org_id,
        account_id=account.id,
        lead_id=lead.id if lead else None,
        target_name=target,
        target_jid=target,
        body=body,
        sender_type=sender_type,
    )
    db.add(job)
    db.flush()
    return job.id


def execute_event_rules(db: Session, *, event: InstagramEvent, account: ChannelAccount, lead: Lead | None) -> dict[str, Any]:
    rules = (
        db.query(AutomationRule)
        .filter(
            AutomationRule.org_id == account.org_id,
            AutomationRule.enabled.is_(True),
            AutomationRule.trigger_type.in_(("instagram_comment", "instagram_event")),
        )
        .order_by(AutomationRule.priority.asc(), AutomationRule.created_at.asc())
        .all()
    )
    result: dict[str, Any] = {"matched": 0, "actions": []}
    for rule in rules:
        if rule.source_account_id and rule.source_account_id != account.id:
            continue
        if rule.source_channel and rule.source_channel != "instagram":
            continue
        if rule.trigger_type == "instagram_comment" and event.event_type not in ("comment", "comment_reply"):
            continue
        if rule.conditions and not all(_condition_matches(event, condition) for condition in rule.conditions):
            continue
        run = AutomationRun(org_id=account.org_id, rule_id=rule.id, event_id=event.id, status="running")
        db.add(run)
        db.flush()
        result["matched"] += 1
        for action in rule.actions:
            action_type = str(action.get("type") or "").strip().lower()
            if action_type == "tag" and lead:
                tags = list(lead.tags or [])
                tag = str(action.get("tag") or action.get("value") or "").strip()
                if tag and tag not in tags:
                    tags.append(tag)
                    lead.tags = tags
                result["actions"].append("tag")
            elif action_type in ("comment_reply", "public_reply"):
                text = str(action.get("text") or action.get("body") or "").strip()
                if text and event.external_media_id:
                    _queue_outbound(
                        db,
                        account=account,
                        lead=lead,
                        body=text,
                        target=f"instagram:comment:{event.external_media_id}:{event.external_event_id}",
                    )
                    result["actions"].append("comment_reply")
            elif action_type in ("dm", "send_dm"):
                text = str(action.get("text") or action.get("body") or "").strip()
                if text and lead:
                    _queue_outbound(
                        db,
                        account=account,
                        lead=lead,
                        body=text,
                        target=f"instagram:user:{event.external_author_id}",
                    )
                    result["actions"].append("dm")
        run.status = "completed"
        run.result = {"actions": result["actions"]}
        db.add(run)
    return result


def ingest_event(db: Session, *, account: ChannelAccount, body: InstagramEventIn) -> dict[str, Any]:
    from app.services.instagram_events import ingest_instagram_event

    result = ingest_instagram_event(db, account=account, body=body)
    event = db.get(InstagramEvent, result["event_id"])
    if result.get("duplicate") or not event:
        return result
    lead = _upsert_lead(db, event, account)
    if body.event_type == "dm":
        from app.routers.messages import process_message_ingest

        ingest = MessageIngestIn(
            account_id=account.id,
            chat_name=str((_author(event).get("full_name") or _author(event).get("username") or event.external_author_id)),
            body=event.body,
            external_chat_id=f"instagram:thread:{event.external_thread_id}",
            external_message_id=event.external_event_id,
            chat_type="pv",
            sender_type="customer",
        )
        message = process_message_ingest(db=db, org_id=account.org_id, body=ingest, acc=account)
        event.message_id = message.id
        event.status = "processed"
    else:
        event.status = "processed"
        execute_event_rules(db, event=event, account=account, lead=lead)
    db.add(event)
    db.commit()
    return {**result, "lead_id": lead.id if lead else ""}
