"""Detect WhatsApp chat bot pause/resume commands in inbound message text."""

from __future__ import annotations

import re

_STOP_RE = re.compile(
    r"^(?:stop|pause|halt|/stop|#stop|توقف|قطع|بس|ایست|خاموش)$",
    re.IGNORECASE,
)
_START_RE = re.compile(
    r"^(?:start|resume|go|/start|#start|شروع|ادامه|روشن|فعال)$",
    re.IGNORECASE,
)

BOT_ACK_STOP = "ربات برای این چت متوقف شد. برای فعال‌سازی «شروع» یا «start» بفرستید."
BOT_ACK_START = "ربات برای این چت فعال شد."


def parse_bot_command(text: str) -> str | None:
    """Return 'stop', 'start', or None."""
    t = (text or "").strip()
    if not t:
        return None
    if _STOP_RE.match(t):
        return "stop"
    if _START_RE.match(t):
        return "start"
    return None
