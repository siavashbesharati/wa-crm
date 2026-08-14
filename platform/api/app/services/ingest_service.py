"""Shared message ingest used by extension JWT route and server connectors."""

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
    allow_divar_api: bool = False,
) -> MessageIngestOut:
    """
    Persist inbound/outbound channel messages and run bot/AI post-handlers.

    When allow_* flags are False (public /messages/ingest), server-owned
    accounts reject extension ingest so only the matching sidecar feeds them.
    """
    from app.routers import messages as messages_router

    acc = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.id == body.account_id, ChannelAccount.org_id == org_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")

    connector = (getattr(acc, "connector_type", None) or "extension").strip().lower()
    channel = str(getattr(acc.channel, "value", acc.channel) or "")

    if (
        not allow_baileys_extension
        and connector == "baileys"
        and channel == "whatsapp"
    ):
        raise HTTPException(
            status_code=409,
            detail="این اکانت واتساپ روی Baileys است؛ ingest فقط از کانکتور سرور مجاز است",
        )

    if not allow_divar_api and connector == "divar_api" and channel == "divar":
        raise HTTPException(
            status_code=409,
            detail="این اکانت دیوار روی کانکتور سرور است؛ ingest فقط از divar-connector مجاز است",
        )

    return messages_router.process_message_ingest(
        db=db,
        org_id=org_id,
        body=body,
        acc=acc,
        background_tasks=background_tasks,
    )
