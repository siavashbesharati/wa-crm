"""Pinecone serverless knowledge base with hosted multilingual-e5 embeddings.

SQLite remains the document catalog; Pinecone owns vector search.
Namespace = org_id so tenants never mix.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger("pinecone_kb")

# Record field mapped to model input "text" via field_map
TEXT_FIELD = "chunk_text"
EMBED_MODEL = "multilingual-e5-large"


class PineconeNotConfigured(RuntimeError):
    pass


@dataclass
class KbSearchHit:
    id: str
    content: str
    score: float
    doc_id: str = ""
    title: str = ""


def resolve_pinecone_api_key(db: Session | None = None) -> str:
    """Super-admin PlatformSetting key wins over Settings default."""
    settings = get_settings()
    key = (getattr(settings, "pinecone_api_key", None) or "").strip()
    if db is not None:
        try:
            from app.services.ai_reply import get_platform_ai_settings

            platform = get_platform_ai_settings(db)
            override = (platform.get("pinecone_api_key") or "").strip()
            if override:
                key = override
        except Exception:  # noqa: BLE001
            pass
    return key


def is_configured(db: Session | None = None) -> bool:
    return bool(resolve_pinecone_api_key(db))


def _client(api_key: str):
    from pinecone import Pinecone

    return Pinecone(api_key=api_key)


@lru_cache(maxsize=4)
def _ensure_index_cached(api_key: str, index_name: str, cloud: str, region: str) -> str:
    """Create integrated-embedding index once per process if missing. Returns index name."""
    pc = _client(api_key)
    existing = {idx.name for idx in pc.list_indexes()}
    if index_name in existing:
        return index_name

    logger.info("creating Pinecone index %s (model=%s)", index_name, EMBED_MODEL)
    try:
        pc.create_index_for_model(
            name=index_name,
            cloud=cloud,
            region=region,
            embed={
                "model": EMBED_MODEL,
                "field_map": {"text": TEXT_FIELD},
            },
        )
    except Exception as exc:  # noqa: BLE001
        # Race / already exists
        msg = str(exc).lower()
        if "already" not in msg and "exist" not in msg:
            raise
        logger.info("index create race for %s: %s", index_name, exc)
    return index_name


def ensure_index(db: Session | None = None) -> str:
    settings = get_settings()
    api_key = resolve_pinecone_api_key(db)
    if not api_key:
        raise PineconeNotConfigured("کلید Pinecone تنظیم نشده است")
    name = (settings.pinecone_index or "iranexpedia-kb").strip()
    cloud = (settings.pinecone_cloud or "aws").strip()
    region = (settings.pinecone_region or "us-east-1").strip()
    return _ensure_index_cached(api_key, name, cloud, region)


def _index(db: Session | None = None):
    api_key = resolve_pinecone_api_key(db)
    if not api_key:
        raise PineconeNotConfigured("کلید Pinecone تنظیم نشده است")
    name = ensure_index(db)
    return _client(api_key).Index(name)


def upsert_chunks(
    *,
    org_id: str,
    doc_id: str,
    title: str,
    chunks: list[tuple[str, str]],
    db: Session | None = None,
) -> int:
    """Upsert (chunk_id, text) pairs into namespace=org_id. Returns record count."""
    if not org_id or not chunks:
        return 0
    index = _index(db)
    records: list[dict[str, Any]] = []
    for chunk_id, text in chunks:
        text = (text or "").strip()
        if not chunk_id or not text:
            continue
        records.append(
            {
                "_id": chunk_id,
                TEXT_FIELD: text,
                "doc_id": doc_id,
                "title": (title or "")[:200],
            }
        )
    if not records:
        return 0
    # Batch in groups of 90 (API limit safety)
    total = 0
    for i in range(0, len(records), 90):
        batch = records[i : i + 90]
        index.upsert_records(namespace=org_id, records=batch)
        total += len(batch)
    return total


def upsert_doc_from_db(db: Session, *, org_id: str, doc_id: str) -> int:
    """Load SQLite chunks for a doc and upsert to Pinecone."""
    from app.models import KnowledgeChunk, KnowledgeDoc

    doc = (
        db.query(KnowledgeDoc)
        .filter(KnowledgeDoc.id == doc_id, KnowledgeDoc.org_id == org_id)
        .first()
    )
    if not doc:
        return 0
    rows = (
        db.query(KnowledgeChunk)
        .filter(KnowledgeChunk.org_id == org_id, KnowledgeChunk.doc_id == doc_id)
        .all()
    )
    pairs = [(r.id, r.content or "") for r in rows if (r.content or "").strip()]
    if not pairs:
        return 0
    return upsert_chunks(
        org_id=org_id,
        doc_id=doc_id,
        title=doc.title or "",
        chunks=pairs,
        db=db,
    )


def search(
    *,
    org_id: str,
    query: str,
    k: int = 4,
    db: Session | None = None,
) -> list[KbSearchHit]:
    q = (query or "").strip()
    if not org_id or not q:
        return []
    index = _index(db)
    top_k = max(1, min(int(k or 4), 20))
    try:
        results = index.search(
            namespace=org_id,
            top_k=top_k,
            inputs={"text": q},
            fields=[TEXT_FIELD, "doc_id", "title"],
        )
    except TypeError:
        # Older plugin signature
        results = index.search_records(
            namespace=org_id,
            query={"inputs": {"text": q}, "top_k": top_k},
            fields=[TEXT_FIELD, "doc_id", "title"],
        )

    hits: list[KbSearchHit] = []
    raw_hits = []
    if hasattr(results, "result") and results.result is not None:
        raw_hits = getattr(results.result, "hits", None) or []
    elif isinstance(results, dict):
        raw_hits = (
            (results.get("result") or {}).get("hits")
            or results.get("matches")
            or results.get("hits")
            or []
        )
    else:
        raw_hits = getattr(results, "hits", None) or []

    for h in raw_hits:
        if isinstance(h, dict):
            hid = str(h.get("_id") or h.get("id") or "")
            score = float(h.get("_score") or h.get("score") or 0.0)
            fields = h.get("fields") or h.get("metadata") or {}
        else:
            hid = str(getattr(h, "id", None) or getattr(h, "_id", "") or "")
            score = float(getattr(h, "score", None) or getattr(h, "_score", 0.0) or 0.0)
            fields = getattr(h, "fields", None) or {}
            if not isinstance(fields, dict):
                fields = {}
        content = str(fields.get(TEXT_FIELD) or fields.get("text") or "").strip()
        if not content:
            continue
        hits.append(
            KbSearchHit(
                id=hid,
                content=content,
                score=score,
                doc_id=str(fields.get("doc_id") or ""),
                title=str(fields.get("title") or ""),
            )
        )
    return hits


def delete_doc(*, org_id: str, doc_id: str, db: Session | None = None) -> None:
    """Delete all vectors for a document in the org namespace."""
    if not org_id or not doc_id:
        return
    if not is_configured(db):
        return
    index = _index(db)
    try:
        index.delete(namespace=org_id, filter={"doc_id": {"$eq": doc_id}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("pinecone delete_doc failed org=%s doc=%s: %s", org_id, doc_id, exc)
        # Fallback: delete by known chunk ids from SQLite if filter unsupported
        if db is not None:
            from app.models import KnowledgeChunk

            ids = [
                r.id
                for r in db.query(KnowledgeChunk.id)
                .filter(KnowledgeChunk.org_id == org_id, KnowledgeChunk.doc_id == doc_id)
                .all()
            ]
            if ids:
                try:
                    index.delete(ids=ids, namespace=org_id)
                except Exception as exc2:  # noqa: BLE001
                    logger.warning("pinecone delete by ids failed: %s", exc2)


def fetch_chunk_status(
    *,
    org_id: str,
    chunk_ids: list[str],
    db: Session | None = None,
) -> dict[str, dict[str, Any]]:
    """Return Pinecone record info keyed by chunk id (presence + stored text fields)."""
    out: dict[str, dict[str, Any]] = {}
    ids = [i for i in chunk_ids if i]
    if not org_id or not ids or not is_configured(db):
        return out
    try:
        index = _index(db)
        # Fetch in batches of 100
        for i in range(0, len(ids), 100):
            batch = ids[i : i + 100]
            try:
                res = index.fetch(ids=batch, namespace=org_id)
            except TypeError:
                res = index.fetch(ids=batch, namespace=org_id)
            vectors = {}
            if isinstance(res, dict):
                vectors = res.get("vectors") or res.get("records") or {}
            else:
                vectors = getattr(res, "vectors", None) or getattr(res, "records", None) or {}
            if hasattr(vectors, "items"):
                items = vectors.items()
            elif isinstance(vectors, dict):
                items = vectors.items()
            else:
                items = []
            for vid, payload in items:
                fields: dict[str, Any] = {}
                values: list[float] = []
                if isinstance(payload, dict):
                    fields = payload.get("metadata") or payload.get("fields") or {}
                    values = list(payload.get("values") or [])[:12]
                else:
                    meta = getattr(payload, "metadata", None) or getattr(payload, "fields", None) or {}
                    if isinstance(meta, dict):
                        fields = meta
                    values = list(getattr(payload, "values", None) or [])[:12]
                out[str(vid)] = {
                    "in_pinecone": True,
                    "chunk_text": str(fields.get(TEXT_FIELD) or fields.get("text") or "")[:400],
                    "doc_id": str(fields.get("doc_id") or ""),
                    "title": str(fields.get("title") or ""),
                    "vector_dim": len(values) if values else None,
                    "vector_preview": values,
                }
    except Exception as exc:  # noqa: BLE001
        logger.warning("pinecone fetch_chunk_status failed: %s", exc)
    return out


def reindex_all(db: Session) -> dict[str, int]:
    """Upsert every knowledge chunk in the DB into Pinecone."""
    from app.models import KnowledgeDoc

    if not is_configured(db):
        raise PineconeNotConfigured("کلید Pinecone تنظیم نشده است")
    ensure_index(db)
    docs = db.query(KnowledgeDoc).all()
    upserted = 0
    failed = 0
    for doc in docs:
        try:
            upserted += upsert_doc_from_db(db, org_id=doc.org_id, doc_id=doc.id)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            logger.warning("reindex doc=%s failed: %s", doc.id, exc)
    return {"docs": len(docs), "chunks_upserted": upserted, "failed_docs": failed}
