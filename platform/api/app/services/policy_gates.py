"""AI policy gates: business hours + confidence checks."""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone

from app.models import AiPolicy

# Iran Standard Time (no DST)
TEHRAN = timezone(timedelta(hours=3, minutes=30))


def _parse_hhmm(value: str, default: time) -> time:
    raw = (value or "").strip()
    if not raw:
        return default
    try:
        parts = raw.split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        if 0 <= h <= 23 and 0 <= m <= 59:
            return time(h, m)
    except (TypeError, ValueError, IndexError):
        pass
    return default


def within_business_hours(policy: AiPolicy | None, *, now: datetime | None = None) -> bool:
    """Return True if auto-send is allowed under business-hours policy."""
    if not policy or not policy.business_hours_only:
        return True
    local = (now or datetime.now(TEHRAN)).astimezone(TEHRAN)
    start = _parse_hhmm(policy.hours_start, time(9, 0))
    end = _parse_hhmm(policy.hours_end, time(18, 0))
    t = local.time()
    if start <= end:
        return start <= t <= end
    # overnight window e.g. 22:00–06:00
    return t >= start or t <= end


def meets_min_confidence(policy: AiPolicy | None, confidence: float) -> bool:
    if not policy:
        return True
    try:
        min_c = float(policy.min_confidence)
    except (TypeError, ValueError):
        min_c = 0.45
    try:
        conf = float(confidence)
    except (TypeError, ValueError):
        conf = 0.0
    return conf >= min_c
