"""Per-phone, per-channel cooldown for connection (pairing) requests.

The user can pair at most once every ``DEFAULT_WINDOW_SEC`` seconds for the
same phone number on the same channel. This protects WhatsApp / Bale / Divar
from being flooded with reconnection attempts and from accidental duplicate
OTPs. The limit is keyed on the *normalized* phone digits (e.g. "98912…"), so
"+98 912 123 4567", "98912…" and "۰۹۱۲…" all share the same bucket.

Storage is in-process (a single dict under a threading lock). This matches
the rest of the project (``chat_presence``, ``sse_hub``). If/when the API is
scaled to multiple uvicorn workers, swap the dict for Redis with the same
public API.
"""

from __future__ import annotations

import threading
import time
from typing import Literal

Channel = Literal["whatsapp", "bale", "divar"]

# 5 minutes per the product spec.
DEFAULT_WINDOW_SEC = 5 * 60

_lock = threading.Lock()
# key: f"{channel}:{phone_digits}" -> float (unix timestamp of the last attempt)
_last_attempt: dict[str, float] = {}


def _key(channel: Channel, phone_digits: str) -> str:
    ch = (channel or "").strip().lower()
    ph = (phone_digits or "").strip()
    return f"{ch}:{ph}"


def _purge_expired(now: float, window_sec: float) -> None:
    """Drop entries older than ``window_sec`` to keep the dict small."""
    if len(_last_attempt) < 256:
        return  # nothing to do for small maps
    cutoff = now - window_sec
    for k, ts in list(_last_attempt.items()):
        if ts <= cutoff:
            _last_attempt.pop(k, None)


def check_and_record(
    channel: Channel,
    phone_digits: str,
    *,
    window_sec: float = DEFAULT_WINDOW_SEC,
    now: float | None = None,
) -> tuple[bool, int]:
    """Atomically check the cooldown and record a new attempt.

    Returns ``(allowed, retry_after_sec)``:

    - ``allowed=True``  — the caller may proceed; the timestamp is now stored.
    - ``allowed=False`` — too soon; the caller should reject with HTTP 429.
      ``retry_after_sec`` is the number of seconds the client should wait
      before trying again (always >= 1 when blocked).
    """
    ch = (channel or "").strip().lower()
    ph = (phone_digits or "").strip()
    if not ch or not ph:
        # Without a phone we can't key the limit; let the request through
        # and let downstream validation handle missing input.
        return True, 0
    t = float(now) if now is not None else time.time()
    k = _key(ch, ph)
    with _lock:
        _purge_expired(t, window_sec)
        last = _last_attempt.get(k)
        if last is not None and (t - last) < window_sec:
            retry = int(max(1, window_sec - (t - last)))
            return False, retry
        _last_attempt[k] = t
        return True, 0


def remaining_sec(
    channel: Channel,
    phone_digits: str,
    *,
    window_sec: float = DEFAULT_WINDOW_SEC,
    now: float | None = None,
) -> int:
    """How many seconds the caller must still wait (0 if ready now)."""
    ch = (channel or "").strip().lower()
    ph = (phone_digits or "").strip()
    if not ch or not ph:
        return 0
    t = float(now) if now is not None else time.time()
    k = _key(ch, ph)
    with _lock:
        last = _last_attempt.get(k)
        if last is None:
            return 0
        diff = t - last
        if diff >= window_sec:
            return 0
        return int(max(1, window_sec - diff))


def reset_for_tests() -> None:
    """Clear the in-memory state. Only used by unit tests."""
    with _lock:
        _last_attempt.clear()


def humanize_wait(seconds: int) -> str:
    """Format a number of seconds as a short Persian wait string.

    Examples (Persian / Latin digits):
        60   -> "۱ دقیقه"
        120  -> "۲ دقیقه"
        65   -> "۱ دقیقه و ۵ ثانیه"
    """
    s = max(0, int(seconds))
    if s < 60:
        return f"{_fa(s)} ثانیه"
    m, rem = divmod(s, 60)
    if rem == 0:
        return f"{_fa(m)} دقیقه"
    return f"{_fa(m)} دقیقه و {_fa(rem)} ثانیه"


def _fa(n: int) -> str:
    """Convert ASCII digits to Persian digits (e.g. 12 -> ۱۲)."""
    table = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
    return str(int(n)).translate(table)


def raise_too_soon(channel: Channel, retry_after_sec: int):
    """Raise a 429 with a Persian message and a ``Retry-After`` header.

    Imported lazily so this module can be used without FastAPI at import
    time (e.g. in unit tests).
    """
    from fastapi import HTTPException

    ch_fa = {
        "whatsapp": "واتساپ",
        "bale": "بله",
        "divar": "دیوار",
    }.get((channel or "").strip().lower(), "کانال")
    wait = humanize_wait(retry_after_sec)
    raise HTTPException(
        status_code=429,
        detail=(
            f"برای اتصال {ch_fa} با این شماره باید {wait} صبر کنید "
            "و سپس دوباره تلاش کنید."
        ),
        headers={"Retry-After": str(int(retry_after_sec))},
    )

