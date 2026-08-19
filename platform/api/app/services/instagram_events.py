from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import ChannelAccount, InstagramEvent
from app.schemas import InstagramEventIn


def ingest_instagram_event(
    db: Session,
    *,
    account: ChannelAccount,
    body: InstagramEventIn,
) -> dict:
    existing = (
        db.query(InstagramEvent)
        .filter(
            InstagramEvent.account_id == account.id,
            InstagramEvent.event_type == body.event_type,
            InstagramEvent.external_event_id == body.external_event_id,
        )
        .first()
    )
    if existing:
        return {"ok": True, "duplicate": True, "event_id": existing.id}

    event = InstagramEvent(
        org_id=account.org_id,
        account_id=account.id,
        event_type=body.event_type,
        external_event_id=body.external_event_id,
        external_thread_id=body.external_thread_id,
        external_media_id=body.external_media_id,
        external_author_id=body.external_author_id,
        parent_comment_id=body.parent_comment_id,
        body=body.body,
        author_json=body.author,
        occurred_at=body.occurred_at,
    )
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(InstagramEvent)
            .filter(
                InstagramEvent.account_id == account.id,
                InstagramEvent.event_type == body.event_type,
                InstagramEvent.external_event_id == body.external_event_id,
            )
            .first()
        )
        if existing:
            return {"ok": True, "duplicate": True, "event_id": existing.id}
        raise
    db.refresh(event)
    return {"ok": True, "duplicate": False, "event_id": event.id}
