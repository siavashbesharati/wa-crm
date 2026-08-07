"""Zibal payment gateway wrapper (pip package: zibal)."""

from __future__ import annotations

import json
from typing import Any

from app.config import get_settings

START_URL = "https://gateway.zibal.ir/start/{track_id}"


def _client(callback_url: str | None = None):
    import zibal.zibal as zibal

    settings = get_settings()
    cb = callback_url or f"{settings.public_base_url.rstrip('/')}/api/payments/zibal/callback"
    return zibal.zibal(settings.zibal_merchant_id, cb), cb


def payment_start_url(track_id: str | int) -> str:
    return START_URL.format(track_id=track_id)


def request_payment(
    amount_irr: int,
    *,
    callback_url: str | None = None,
    description: str = "",
) -> dict[str, Any]:
    """Create a Zibal transaction. Amount is Rials (as stored in plans)."""
    zb, cb = _client(callback_url)
    # Official package: zb.request(amount)
    raw = zb.request(int(amount_irr))
    if not isinstance(raw, dict):
        raw = {"result": -1, "message": str(raw)}
    result = raw.get("result")
    track_id = raw.get("trackId") or raw.get("track_id") or ""
    message = ""
    try:
        message = zb.request_result(result) if result is not None else ""
    except Exception:
        message = str(raw.get("message") or "")
    ok = int(result or 0) == 100 and bool(track_id)
    return {
        "ok": ok,
        "result": result,
        "track_id": str(track_id) if track_id else "",
        "message": message,
        "payment_url": payment_start_url(track_id) if track_id else "",
        "callback_url": cb,
        "description": description,
        "raw": raw,
        "raw_json": json.dumps(raw, ensure_ascii=False),
    }


def verify_payment(track_id: str) -> dict[str, Any]:
    zb, _cb = _client()
    # Zibal expects numeric trackId in the verify body
    tid: str | int = track_id
    try:
        tid = int(str(track_id).strip())
    except (TypeError, ValueError):
        tid = str(track_id).strip()
    raw = zb.verify(tid)
    if not isinstance(raw, dict):
        raw = {"result": -1, "message": str(raw)}
    result = raw.get("result")
    ref = raw.get("refNumber") or raw.get("ref_number") or ""
    message = ""
    try:
        message = zb.verify_result(result) if result is not None else ""
    except Exception:
        message = str(raw.get("message") or "")
    # 100 = success (first verify), 201 = already verified
    ok = int(result or 0) in (100, 201)
    return {
        "ok": ok,
        "result": result,
        "ref_number": str(ref) if ref else "",
        "message": message,
        "raw": raw,
        "raw_json": json.dumps(raw, ensure_ascii=False),
    }
