"""Iranian mobile normalization for anything stored in the database.

Canonical form: 09XXXXXXXXX (ASCII digits). APIs that need country-code
digits (Baileys, Bale, sms.ir) convert at the edge via to_cc_digits().
"""

from __future__ import annotations

import re

_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_IR_LOCAL = re.compile(r"^09\d{9}$")


def ascii_digits(phone: str) -> str:
    raw = (phone or "").translate(_PERSIAN_DIGITS)
    return re.sub(r"\D", "", raw)


def try_normalize_ir_mobile(phone: str) -> str | None:
    """Return 09XXXXXXXXX, or None if this is not an Iranian mobile."""
    d = ascii_digits(phone)
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("98") and len(d) == 12:
        d = "0" + d[2:]
    elif d.startswith("9") and len(d) == 10:
        d = "0" + d
    if _IR_LOCAL.fullmatch(d):
        return d
    return None


def normalize_ir_mobile(phone: str) -> str:
    local = try_normalize_ir_mobile(phone)
    if not local:
        raise ValueError("شماره موبایل نامعتبر است")
    return local


def normalize_phone_for_storage(phone: str) -> str:
    """Canonical DB value: Iranian mobiles as 09…; otherwise ASCII digits."""
    if not (phone or "").strip():
        return ""
    ir = try_normalize_ir_mobile(phone)
    if ir:
        return ir
    return ascii_digits(phone)


def to_cc_digits(phone: str) -> str:
    """Country-code digits (IR → 98912…). Used by WhatsApp pairing and Bale."""
    ir = try_normalize_ir_mobile(phone)
    if ir:
        return "98" + ir[1:]
    return ascii_digits(phone)


def phone_aliases(phone: str) -> list[str]:
    """Equivalent spellings so older +98 / 98 / 09 rows still match."""
    keys: set[str] = set()
    raw = (phone or "").strip()
    if raw:
        keys.add(raw)
    d = ascii_digits(phone)
    if d:
        keys.add(d)
        keys.add("+" + d)
    ir = try_normalize_ir_mobile(phone)
    if ir:
        cc = "98" + ir[1:]
        keys.update({ir, cc, "+" + cc, "00" + cc})
    return [k for k in keys if k]
