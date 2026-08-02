from __future__ import annotations

import hashlib
import math
import re

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
