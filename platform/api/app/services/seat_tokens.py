from __future__ import annotations

import hashlib
import secrets


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_raw_token() -> str:
    return "seat_" + secrets.token_urlsafe(24)
