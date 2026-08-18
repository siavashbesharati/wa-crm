"""Bale phone-OTP auth wrappers. Never log or raise access tokens."""

from __future__ import annotations

import logging
import re
from typing import Any

log = logging.getLogger("bale-auth")

_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


class BaleAuthError(Exception):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _safe_exc_text(exc: BaseException) -> str:
    """Drop JWT-looking fragments from library errors before surfacing them."""
    text = str(exc or "")
    text = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[redacted]", text)
    return text[:240]


def normalize_iranian_phone(phone: str) -> int:
    """Normalize Iranian numbers to the int form expected by bale.auth (e.g. 98912…)."""
    raw = (phone or "").translate(_PERSIAN_DIGITS)
    raw = re.sub(r"[\s\-()]", "", raw)
    if raw.startswith("+"):
        raw = raw[1:]
    if raw.startswith("00"):
        raw = raw[2:]
    if raw.startswith("0") and len(raw) == 11:
        raw = "98" + raw[1:]
    if raw.startswith("9") and len(raw) == 10:
        raw = "98" + raw
    if not re.fullmatch(r"98\d{10}", raw):
        raise BaleAuthError("شماره موبایل نامعتبر است")
    return int(raw)


def format_phone_display(phone_int: int | str) -> str:
    digits = re.sub(r"\D", "", str(phone_int or ""))
    if digits.startswith("98") and len(digits) == 12:
        return "0" + digits[2:]
    return digits


def start_phone_auth(phone: str) -> dict[str, Any]:
    """Request a Bale login code. OTP is commonly delivered in the Bale app."""
    phone_int = normalize_iranian_phone(phone)
    try:
        from bale import auth as bale_auth
    except ImportError as exc:
        raise BaleAuthError(
            "کتابخانه بله روی سرور نصب نیست (bale-sdk)",
            status_code=503,
        ) from exc

    try:
        session = bale_auth.start_phone_auth(phone_int)
    except ValueError as exc:
        raise BaleAuthError("شماره موبایل نامعتبر است") from exc
    except Exception as exc:  # noqa: BLE001
        log.warning("[Bale] OTP request failed: %s", _safe_exc_text(exc))
        raise BaleAuthError("ارسال کد ورود ناموفق بود", status_code=502) from exc

    tx = getattr(session, "transaction_hash", "") or ""
    if not tx:
        raise BaleAuthError("پاسخ احراز هویت بله ناقص است", status_code=502)

    sent_code_type = int(getattr(session, "sent_code_type", 0) or 0)
    log.info("[Bale] OTP requested phone=%s sent_code_type=%s", format_phone_display(phone_int), sent_code_type)
    return {
        "phone": str(phone_int),
        "transaction_hash": tx,
        "is_registered": bool(getattr(session, "is_registered", False)),
        "activation_type": int(getattr(session, "activation_type", 0) or 0),
        "sent_code_type": sent_code_type,
    }


def validate_code(pending: dict[str, Any], code: str) -> dict[str, Any]:
    """Complete OTP. Returns session blob — caller must encrypt; never log token."""
    code = (code or "").translate(_PERSIAN_DIGITS).strip()
    if not re.fullmatch(r"^\d{5}$", code):
        raise BaleAuthError("کد ورود باید ۵ رقم باشد")
    tx = str((pending or {}).get("transaction_hash") or "").strip()
    if not tx:
        raise BaleAuthError("ابتدا شماره را ارسال کنید")

    try:
        from bale import auth as bale_auth
    except ImportError as exc:
        raise BaleAuthError(
            "کتابخانه بله روی سرور نصب نیست (bale-sdk)",
            status_code=503,
        ) from exc

    try:
        result = bale_auth.validate_code(tx, code)
    except ValueError as exc:
        raise BaleAuthError("کد ورود نامعتبر است") from exc
    except Exception as exc:  # noqa: BLE001
        msg = _safe_exc_text(exc).lower()
        if "code" in msg or "otp" in msg or "invalid" in msg or "expired" in msg:
            raise BaleAuthError("کد ورود اشتباه یا منقضی است") from exc
        log.warning("[Bale] Authentication failed: %s", _safe_exc_text(exc))
        raise BaleAuthError("احراز هویت بله ناموفق بود", status_code=502) from exc

    token = getattr(result, "access_token", "") or ""
    if not token:
        raise BaleAuthError("نشست بله دریافت نشد", status_code=502)

    user_id = int(getattr(result, "user_id", 0) or 0)
    user_name = str(getattr(result, "user_name", "") or "")
    phone = str((pending or {}).get("phone") or "")
    log.info("[Bale] Authentication successful user_id=%s", user_id or "unknown")
    return {
        "access_token": token,
        "user_id": user_id,
        "user_name": user_name,
        "phone": phone,
    }


def parse_session_blob(raw: str | dict[str, Any] | None) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        token = str(raw.get("access_token") or "").strip()
        if not token:
            return None
        return raw
    if not raw:
        return None
    import json

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not str(data.get("access_token") or "").strip():
        return None
    return data
