"""Detect WhatsApp chat bot pause / resume / human-handoff intents."""

from __future__ import annotations

import re

# Exact whole-message commands (legacy stop/start)
_STOP_RE = re.compile(
    r"^(?:stop|pause|halt|/stop|#stop|توقف|قطع|بس|ایست|خاموش)$",
    re.IGNORECASE,
)
_START_RE = re.compile(
    r"^(?:start|resume|go|/start|#start|شروع|ادامه|روشن|فعال)$",
    re.IGNORECASE,
)

# Soft intents — phrase anywhere in the message
_HANDOFF_RE = re.compile(
    r"(?:"
    r"اپراتور|"
    r"پشتیبان|"
    r"پشتیبان[یي]|"
    r"کارشناس|"
    r"انسان|"
    r"آدم\s*واقعی|"
    r"شخص\s*واقعی|"
    r"صحبت\s*با\s*(?:انسان|آدم|شخص|اپراتور|پشتیبان|کارشناس)|"
    r"حرف\s*با\s*(?:انسان|آدم|شخص|اپراتور|پشتیبان)|"
    r"با\s*(?:یک\s*)?(?:انسان|آدم|شخص|اپراتور|پشتیبان)\s*(?:صحبت|حرف)|"
    r"وصل(?:م|مان)?\s*(?:کن|کنید)?\s*(?:به\s*)?(?:اپراتور|پشتیبان|کارشناس)|"
    r"منشی|"
    r"\boperator\b|"
    r"\b(?:live\s*)?agent\b|"
    r"\bhuman\b|"
    r"\breal\s*person\b|"
    r"talk\s*to\s*(?:a\s*)?(?:human|person|agent|operator)|"
    r"speak\s*(?:to|with)\s*(?:a\s*)?(?:human|person|agent|operator)|"
    r"customer\s*support|"
    r"human\s*support"
    r")",
    re.IGNORECASE,
)

_RESTART_RE = re.compile(
    r"(?:"
    r"ربات\s*(?:را\s*)?(?:روشن|فعال)|"
    r"(?:روشن|فعال)\s*(?:کن|کنید)?\s*(?:کن\s*)?ربات|"
    r"برگشت\s*به\s*ربات|"
    r"بازگشت\s*به\s*ربات|"
    r"شروع\s*(?:کن|کنید)?\s*ربات|"
    r"ربات\s*را?\s*شروع|"
    r"ادامه\s*(?:بده|بدهید)|"
    r"پاسخ\s*خودکار\s*(?:را\s*)?(?:روشن|فعال|شروع)|"
    r"enable\s*(?:the\s*)?bot|"
    r"start\s*(?:the\s*)?bot|"
    r"resume\s*(?:the\s*)?bot|"
    r"bot\s*on|"
    r"turn\s*(?:the\s*)?bot\s*on|"
    r"\bunpause\b"
    r")",
    re.IGNORECASE,
)

BOT_ACK_STOP = (
    "ربات برای این چت متوقف شد. برای فعال‌سازی «شروع» یا «start» بفرستید."
)
BOT_ACK_START = "ربات برای این چت فعال شد."
BOT_ACK_HANDOFF = (
    "پیام و تاریخچه گفتگو برای اپراتور ارسال شد. "
    "همکاران ما در اسرع وقت پاسخ می‌دهند. "
    "برای بازگشت به پاسخ خودکار ربات، «شروع» یا «start» بفرستید."
)


def parse_bot_command(text: str) -> str | None:
    """
    Return intent for this inbound message:
      - 'stop'     exact pause command
      - 'start'    exact/soft resume bot
      - 'handoff'  wants a human operator
      - None
    Priority: exact stop/start → soft restart → soft handoff.
    """
    t = (text or "").strip()
    if not t:
        return None
    if _STOP_RE.match(t):
        return "stop"
    if _START_RE.match(t):
        return "start"
    # Soft restart before handoff so "شروع ربات نه اپراتور" leans resume
    if _RESTART_RE.search(t):
        return "start"
    if _HANDOFF_RE.search(t):
        return "handoff"
    return None


def ack_for_command(cmd: str | None) -> str:
    if cmd == "stop":
        return BOT_ACK_STOP
    if cmd == "start":
        return BOT_ACK_START
    if cmd == "handoff":
        return BOT_ACK_HANDOFF
    return ""
