"""Default post-onboarding tasks for supported communication channels."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import ChannelAccount, ChannelType, Task, TaskStatus
from app.services.contact_tasks import next_board_order

SETUP_WHATSAPP = "setup:whatsapp"
SETUP_DIVAR = "setup:divar"
SETUP_BALE = "setup:bale"
SETUP_INSTAGRAM = "setup:instagram"

SETUP_SPECS: tuple[dict[str, str], ...] = (
    {
        "key": SETUP_WHATSAPP,
        "channel": "whatsapp",
        "title": "اتصال واتساپ",
        "message": "واتساپ کسب‌وکار را از صفحه کانال‌ها وصل کنید.",
    },
    {
        "key": SETUP_DIVAR,
        "channel": "divar",
        "title": "اتصال دیوار",
        "message": "دیوار را از صفحه کانال‌ها وصل کنید.",
    },
    {
        "key": SETUP_BALE,
        "channel": "bale",
        "title": "اتصال بله",
        "message": "حساب بله را از صفحه کانال‌ها وصل کنید.",
    },
    {
        "key": SETUP_INSTAGRAM,
        "channel": "instagram",
        "title": "اتصال اینستاگرام",
        "message": "حساب اینستاگرام را از صفحه کانال‌ها وصل کنید.",
    },
)

_PENDING_PAIRING = frozenset(
    {"qr_pending", "otp_pending", "code_pending", "disconnected", "reconnecting", "auth_required"}
)
_OFF_STATUS = frozenset({"offline", "disconnected"})
_ON_STATUS = frozenset({"online", "connected", "ready", "on"})


def _channel_value(channel: ChannelType | str) -> str:
    if isinstance(channel, ChannelType):
        return channel.value
    return str(channel or "").strip().lower()


def _key_for_channel(channel: ChannelType | str) -> str | None:
    raw = _channel_value(channel)
    if raw == "whatsapp":
        return SETUP_WHATSAPP
    if raw == "divar":
        return SETUP_DIVAR
    if raw == "bale":
        return SETUP_BALE
    if raw == "instagram":
        return SETUP_INSTAGRAM
    return None


def account_is_connected(acc: ChannelAccount) -> bool:
    pairing = (acc.pairing_state or "").strip().lower()
    if pairing in _PENDING_PAIRING:
        return False
    status = (acc.status or "").strip().lower()
    if status in _OFF_STATUS:
        return False
    return pairing == "connected" or status in _ON_STATUS


def org_channel_connected(db: Session, org_id: str, channel: str) -> bool:
    try:
        ch = ChannelType(channel)
    except ValueError:
        return False
    rows = (
        db.query(ChannelAccount)
        .filter(ChannelAccount.org_id == org_id, ChannelAccount.channel == ch)
        .all()
    )
    return any(account_is_connected(a) for a in rows)


def complete_setup_task_for_channel(db: Session, org_id: str, channel: ChannelType | str) -> bool:
    key = _key_for_channel(channel)
    if not key:
        return False
    task = (
        db.query(Task)
        .filter(
            Task.org_id == org_id,
            Task.source_message_id == key,
            Task.status.in_((TaskStatus.open, TaskStatus.in_progress)),
        )
        .first()
    )
    if not task:
        return False
    task.status = TaskStatus.done
    task.board_order = next_board_order(db, org_id, TaskStatus.done)
    task.updated_at = datetime.utcnow()
    db.add(task)
    return True


def maybe_complete_setup_tasks_for_account(db: Session, acc: ChannelAccount | None) -> bool:
    if not acc or not account_is_connected(acc):
        return False
    return complete_setup_task_for_channel(db, acc.org_id, acc.channel)


def ensure_onboarding_setup_tasks(
    db: Session,
    *,
    org_id: str,
    user_id: str | None = None,
) -> list[Task]:
    keys = [s["key"] for s in SETUP_SPECS]
    existing = {
        (t.source_message_id or ""): t
        for t in db.query(Task)
        .filter(Task.org_id == org_id, Task.source_message_id.in_(keys))
        .all()
    }
    created: list[Task] = []
    now = datetime.utcnow()
    for spec in SETUP_SPECS:
        key = spec["key"]
        channel = spec["channel"]
        already = org_channel_connected(db, org_id, channel)
        row = existing.get(key)
        if row:
            if already and row.status in (TaskStatus.open, TaskStatus.in_progress):
                complete_setup_task_for_channel(db, org_id, channel)
            continue
        status = TaskStatus.done if already else TaskStatus.open
        task = Task(
            org_id=org_id,
            lead_id=None,
            title=spec["title"],
            message=spec["message"],
            assignee_id=user_id,
            created_by_id=user_id,
            due_at=None if already else now,
            status=status,
            board_order=next_board_order(db, org_id, status),
            source="system",
            source_message_id=key,
        )
        db.add(task)
        db.flush()
        created.append(task)
    return created
