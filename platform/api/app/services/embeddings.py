from __future__ import annotations

import hashlib
import math
import re
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings


def _tokenize(text: str) -> list[str]:
    text = text.lower()
    text = re.sub(r"[^\w\u0600-\u06FF\s]", " ", text)
    return [t for t in text.split() if len(t) > 1]


def embed_text(text: str) -> list[float]:
    """Deterministic local embedding (no external API required for v1)."""
    dim = get_settings().embedding_dim
    vec = [0.0] * dim
    tokens = _tokenize(text)
    if not tokens:
        return vec
    for tok in tokens:
        h = hashlib.sha256(tok.encode("utf-8")).digest()
        idx = int.from_bytes(h[:4], "big") % dim
        sign = 1.0 if h[4] % 2 == 0 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


def chunk_text(content: str, size: int = 500) -> list[str]:
    content = (content or "").strip()
    if not content:
        return []
    parts = []
    buf = []
    count = 0
    for para in re.split(r"\n+", content):
        para = para.strip()
        if not para:
            continue
        if count + len(para) > size and buf:
            parts.append("\n".join(buf))
            buf = [para]
            count = len(para)
        else:
            buf.append(para)
            count += len(para)
    if buf:
        parts.append("\n".join(buf))
    return parts


def _openai_embed(api_key: str, base_url: str, model: str, text: str) -> list[float]:
    url = (base_url or "https://api.openai.com/v1").rstrip("/") + "/embeddings"
    payload = {"model": model, "input": (text or "")[:8000]}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=45.0) as client:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    vec = data["data"][0]["embedding"]
    return [float(x) for x in vec]


def embed_crm_text(
    db: Session | None, text: str, *, prefer_local: bool = False
) -> tuple[list[float], str]:
    """Embed CRM document text. Prefer OpenAI embeddings; fall back to local hash.

    Set prefer_local=True for bulk backfill (seed/reindex) to skip slow API calls.

    Returns (vector, provider_label).
    """
    settings = get_settings()
    raw = (text or "").strip()
    if not raw:
        return [0.0] * int(settings.crm_embedding_dim or settings.embedding_dim), "empty"

    api_key = (settings.openai_api_key or "").strip()
    base_url = (settings.openai_base_url or "https://api.openai.com/v1").strip()
    model = (settings.crm_embedding_model or "text-embedding-3-small").strip()

    if db is not None:
        try:
            from app.services.ai_reply import get_platform_ai_settings

            platform = get_platform_ai_settings(db)
            override_key = (platform.get("api_key") or "").strip()
            if override_key:
                api_key = override_key
            override_base = (platform.get("base_url") or "").strip()
            if override_base:
                base_url = override_base
        except Exception:  # noqa: BLE001
            pass

    if not prefer_local and api_key:
        try:
            return _openai_embed(api_key, base_url, model, raw), f"openai:{model}"
        except Exception:  # noqa: BLE001
            pass

    # Degraded local embedding — works offline; quality is lower for Persian semantics
    return embed_text(raw), "local_hash"


def content_sha1(text: str) -> str:
    return hashlib.sha1((text or "").encode("utf-8")).hexdigest()
