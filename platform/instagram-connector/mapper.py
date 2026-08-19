from __future__ import annotations

from datetime import datetime
from typing import Any


def value(item: Any, key: str, default: Any = "") -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def iso_date(item: Any) -> str | None:
    created = value(item, "timestamp", None) or value(item, "created_at", None)
    if isinstance(created, datetime):
        return created.isoformat()
    return str(created) if created else None


def author_payload(user: Any) -> dict[str, Any]:
    return {
        "pk": str(value(user, "pk", "") or value(user, "user_id", "")),
        "username": str(value(user, "username", "")),
        "full_name": str(value(user, "full_name", "")),
        "profile_pic_url": str(value(user, "profile_pic_url", "")),
    }


def dm_event(thread: Any, message: Any) -> dict[str, Any]:
    thread_id = str(value(thread, "id", "") or value(thread, "thread_id", ""))
    message_id = str(value(message, "id", "") or value(message, "item_id", ""))
    user = value(message, "user", None) or value(message, "sender", None)
    return {
        "event_type": "dm",
        "external_event_id": f"dm:{message_id}",
        "external_thread_id": thread_id,
        "external_author_id": str(value(user, "pk", "") or value(user, "user_id", "")),
        "body": str(value(message, "text", "") or ""),
        "author": author_payload(user) if user else {},
        "occurred_at": iso_date(message),
    }


def comment_event(media_id: str, comment: Any, event_type: str = "comment") -> dict[str, Any]:
    comment_id = str(value(comment, "pk", "") or value(comment, "id", ""))
    user = value(comment, "user", None) or value(comment, "author", None)
    parent = value(comment, "parent_comment_id", "")
    return {
        "event_type": event_type,
        "external_event_id": f"comment:{comment_id}",
        "external_media_id": str(media_id),
        "external_author_id": str(value(user, "pk", "") or value(user, "user_id", "")),
        "parent_comment_id": str(parent or ""),
        "body": str(value(comment, "text", "") or ""),
        "author": author_payload(user) if user else {},
        "occurred_at": iso_date(comment),
    }
