"""Shared message ingest used by extension JWT route and Baileys internal API."""

from __future__ import annotations

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from app.models import ChannelAccount
from app.schemas import MessageIngestIn, MessageIngestOut


def process_message_ingest(
    db: Session,
    org_id: str,
    body: MessageIngestIn,
    background_tasks: BackgroundTasks | None = None,
    *,
    allow_baileys_extension: bool = False,
) -> MessageIngestOut:
    """
    Persist inbound/outbound channel messages and run bot/AI post-handlers.

    When allow_baileys_extension is False (default for public /messages/ingest),
    WhatsApp accounts with connector_type=baileys reject extension ingest so
    only the server sidecar feeds that account.
    """
    # Import lazily to avoid circular imports at module load.
    from app.routers import messages as messages_router

    acc = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == body.account_id, ChannelAccount.org_id == org_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")

    connector = (getattr(acc, "connector_type", None) or "extension").strip().lower()
    if (
        not allow_baileys_extension
        and connector == "baileys"
        and str(getattr(acc.channel, "value", acc.channel) or "") == "whatsapp"
    ):
        raise HTTPException(
            status_code=409,
            detail="این اکانت واتساپ روی Baileys است؛ ingest فقط از کانکتور سرور مجاز است",
        )

    return messages_router.process_message_ingest(
        db=db,
        org_id=org_id,
        body=body,
        acc=acc,
        background_tasks=background_tasks,
    )
