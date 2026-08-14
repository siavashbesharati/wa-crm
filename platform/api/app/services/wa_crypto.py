"""Encrypt / decrypt Baileys auth blobs at rest."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


def _fernet() -> Fernet:
    settings = get_settings()
    raw = (settings.wa_creds_fernet_key or "").strip()
    if not raw:
        # Derive a stable key from jwt_secret so local/dev always works
        digest = hashlib.sha256(settings.jwt_secret.encode("utf-8")).digest()
        raw = base64.urlsafe_b64encode(digest).decode("ascii")
    return Fernet(raw.encode("ascii") if isinstance(raw, str) else raw)


def encrypt_text(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_text(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return ""
