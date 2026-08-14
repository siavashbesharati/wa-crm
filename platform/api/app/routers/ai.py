from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import AiPolicy, KnowledgeDoc, Lead, MemberRole, Message
from app.schemas import AiPolicyIn, KnowledgeIn, SuggestIn, SuggestOut
from app.services.ai_reply import generate_reply, retrieve_knowledge
from app.services.embeddings import chunk_text, embed_text
from app.services.group_reply import (
    GROUP_REPLY_KEYWORDS,
    normalize_group_keywords,
    normalize_group_reply_mode,
    resolve_group_reply_mode,
)
from app.services.queue import enqueue


def _policy_out(policy: AiPolicy) -> dict:
    mode = resolve_group_reply_mode(policy)
    keywords = normalize_group_keywords(getattr(policy, "group_keywords", None))
    return {
        "auto_send_enabled": policy.auto_send_enabled,
        "group_auto_send_enabled": mode == GROUP_REPLY_KEYWORDS,
        "group_reply_mode": mode,
        "group_keywords": keywords,
        "min_confidence": policy.min_confidence,
        "allowed_stages": policy.allowed_stages or [],
        "business_hours_only": policy.business_hours_only,
        "hours_start": policy.hours_start,
        "hours_end": policy.hours_end,
        "agent_role": getattr(policy, "agent_role", "") or "",
        "system_prompt": getattr(policy, "system_prompt", "") or "",
        "fallback_message": getattr(policy, "fallback_message", "") or "",
        "plan_allows_auto": True,
        "plan_allows_suggest": True,
    }


router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/policy")
def get_policy(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == auth.org.id).first()
    if not policy:
        policy = AiPolicy(org_id=auth.org.id)
        db.add(policy)
        db.commit()
        db.refresh(policy)
    return _policy_out(policy)


@router.put("/policy")
def put_policy(
    body: AiPolicyIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == auth.org.id).first()
    if not policy:
        policy = AiPolicy(org_id=auth.org.id)
    policy.auto_send_enabled = body.auto_send_enabled
    mode = normalize_group_reply_mode(
        body.group_reply_mode,
        legacy_enabled=bool(body.group_auto_send_enabled),
    )
    if not body.auto_send_enabled:
        mode = "off"
    keywords = normalize_group_keywords(body.group_keywords)
    if mode == GROUP_REPLY_KEYWORDS and not keywords:
        # Keywords mode without keywords → treat as off (safe default)
        mode = "off"
    policy.group_reply_mode = mode
    policy.group_keywords = keywords
    policy.group_auto_send_enabled = mode == GROUP_REPLY_KEYWORDS
    policy.min_confidence = body.min_confidence
    policy.allowed_stages = body.allowed_stages
    policy.business_hours_only = body.business_hours_only
    policy.hours_start = body.hours_start
    policy.hours_end = body.hours_end
    policy.agent_role = (body.agent_role or "").strip()
    policy.fallback_message = (body.fallback_message or "").strip()
    db.add(policy)
    db.commit()
    return {"ok": True, **_policy_out(policy)}


@router.get("/knowledge")
def list_docs(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    from app.models import KnowledgeChunk
    from sqlalchemy import func

    docs = (
        db.query(KnowledgeDoc)
        .filter(KnowledgeDoc.org_id == auth.org.id)
        .order_by(KnowledgeDoc.created_at.desc())
        .all()
    )
    counts = dict(
        db.query(KnowledgeChunk.doc_id, func.count(KnowledgeChunk.id))
        .filter(KnowledgeChunk.org_id == auth.org.id)
        .group_by(KnowledgeChunk.doc_id)
        .all()
    )
    return [
        {
            "id": d.id,
            "title": d.title,
            "source": d.source,
            "created_at": d.created_at.isoformat(),
            "chunk_count": int(counts.get(d.id) or 0),
        }
        for d in docs
    ]


def _knowledge_detail(db: Session, *, org_id: str, doc: KnowledgeDoc) -> dict:
    from app.models import KnowledgeChunk
    from app.services import pinecone_kb

    chunks = (
        db.query(KnowledgeChunk)
        .filter(KnowledgeChunk.org_id == org_id, KnowledgeChunk.doc_id == doc.id)
        .order_by(KnowledgeChunk.created_at.asc())
        .all()
    )
    content = "\n\n".join((c.content or "").strip() for c in chunks if (c.content or "").strip())
    pinecone_on = pinecone_kb.is_configured(db)
    pinecone_map: dict = {}
    if pinecone_on and chunks:
        pinecone_map = pinecone_kb.fetch_chunk_status(
            org_id=org_id,
            chunk_ids=[c.id for c in chunks],
            db=db,
        )

    chunk_out = []
    for c in chunks:
        emb = c.embedding if isinstance(c.embedding, list) else []
        pc = pinecone_map.get(c.id) or {}
        chunk_out.append(
            {
                "id": c.id,
                "content": c.content or "",
                "char_count": len(c.content or ""),
                "local_embedding_dim": len(emb),
                "local_embedding_preview": [round(float(x), 4) for x in emb[:8]],
                "in_pinecone": bool(pc.get("in_pinecone")),
                "pinecone_vector_dim": pc.get("vector_dim"),
                "pinecone_vector_preview": pc.get("vector_preview") or [],
                "pinecone_text_preview": (pc.get("chunk_text") or "")[:200],
            }
        )

    return {
        "id": doc.id,
        "title": doc.title,
        "source": doc.source,
        "created_at": doc.created_at.isoformat() if doc.created_at else "",
        "content": content,
        "chunk_count": len(chunk_out),
        "pinecone_configured": pinecone_on,
        "pinecone_indexed_count": sum(1 for c in chunk_out if c["in_pinecone"]),
        "chunks": chunk_out,
    }


@router.get("/knowledge/{doc_id}")
def get_knowledge(
    doc_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    doc = (
        db.query(KnowledgeDoc)
        .filter(KnowledgeDoc.id == doc_id, KnowledgeDoc.org_id == auth.org.id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="سند یافت نشد")
    return _knowledge_detail(db, org_id=auth.org.id, doc=doc)


@router.post("/knowledge")
def upload_knowledge(
    body: KnowledgeIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    from app.models import KnowledgeChunk
    from app.services import pinecone_kb

    doc = KnowledgeDoc(org_id=auth.org.id, title=body.title, source="upload")
    db.add(doc)
    db.flush()
    for part in chunk_text(body.content):
        db.add(
            KnowledgeChunk(
                org_id=auth.org.id,
                doc_id=doc.id,
                content=part,
                embedding=embed_text(part),
            )
        )
    db.commit()

    pinecone_ok = False
    if pinecone_kb.is_configured(db):
        try:
            pinecone_kb.upsert_doc_from_db(db, org_id=auth.org.id, doc_id=doc.id)
            pinecone_ok = True
        except Exception:  # noqa: BLE001
            pinecone_ok = False

    # Worker retries Pinecone upsert when immediate push failed (or key was missing)
    enqueue(
        "embed",
        {"doc_id": doc.id, "org_id": auth.org.id, "pinecone_ok": pinecone_ok},
    )
    return {"ok": True, "doc_id": doc.id, "pinecone": pinecone_ok}


@router.put("/knowledge/{doc_id}")
def update_knowledge(
    doc_id: str,
    body: KnowledgeIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    """Replace document text, rebuild chunks, and reindex Pinecone."""
    from app.models import KnowledgeChunk
    from app.services import pinecone_kb

    title = (body.title or "").strip()
    content = (body.content or "").strip()
    if len(title) < 2:
        raise HTTPException(status_code=400, detail="عنوان لازم است")
    if len(content) < 10:
        raise HTTPException(status_code=400, detail="متن دانش خیلی کوتاه است")

    doc = (
        db.query(KnowledgeDoc)
        .filter(KnowledgeDoc.id == doc_id, KnowledgeDoc.org_id == auth.org.id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="سند یافت نشد")

    # Remove old vectors before chunk ids change
    try:
        pinecone_kb.delete_doc(org_id=auth.org.id, doc_id=doc.id, db=db)
    except Exception:  # noqa: BLE001
        pass

    db.query(KnowledgeChunk).filter(
        KnowledgeChunk.org_id == auth.org.id, KnowledgeChunk.doc_id == doc.id
    ).delete(synchronize_session=False)

    doc.title = title
    db.add(doc)
    for part in chunk_text(content):
        db.add(
            KnowledgeChunk(
                org_id=auth.org.id,
                doc_id=doc.id,
                content=part,
                embedding=embed_text(part),
            )
        )
    db.commit()
    db.refresh(doc)

    pinecone_ok = False
    if pinecone_kb.is_configured(db):
        try:
            pinecone_kb.upsert_doc_from_db(db, org_id=auth.org.id, doc_id=doc.id)
            pinecone_ok = True
        except Exception:  # noqa: BLE001
            pinecone_ok = False

    enqueue(
        "embed",
        {"doc_id": doc.id, "org_id": auth.org.id, "pinecone_ok": pinecone_ok},
    )
    detail = _knowledge_detail(db, org_id=auth.org.id, doc=doc)
    return {"ok": True, "pinecone": pinecone_ok, "doc": detail}


@router.delete("/knowledge/{doc_id}")
def delete_knowledge(
    doc_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    from app.models import KnowledgeChunk
    from app.services import pinecone_kb

    doc = (
        db.query(KnowledgeDoc)
        .filter(KnowledgeDoc.id == doc_id, KnowledgeDoc.org_id == auth.org.id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="سند یافت نشد")

    try:
        pinecone_kb.delete_doc(org_id=auth.org.id, doc_id=doc.id, db=db)
    except Exception:  # noqa: BLE001
        pass

    db.query(KnowledgeChunk).filter(
        KnowledgeChunk.org_id == auth.org.id, KnowledgeChunk.doc_id == doc.id
    ).delete(synchronize_session=False)
    db.delete(doc)
    db.commit()
    return {"ok": True, "deleted": True}


# Back-compat export for workers that imported retrieve from here
retrieve = retrieve_knowledge


@router.post("/suggest", response_model=SuggestOut)
def suggest(body: SuggestIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == body.lead_id, Lead.org_id == auth.org.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="لید یافت نشد")

    result = generate_reply(db, org_id=auth.org.id, lead=lead, message=body.message)
    return SuggestOut(
        reply=result["reply"],
        confidence=float(result["confidence"]),
        sources=list(result.get("sources") or []),
    )


@router.post("/auto-reply/run")
def run_auto_reply_for_lead(
    lead_id: str,
    message: str,
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    """Manual trigger used by workers/tests; respects policy."""
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == auth.org.id).first()
    if not policy or not policy.auto_send_enabled:
        return {"sent": False, "reason": "auto_send_disabled"}

    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == auth.org.id).first()
    if not lead or lead.bot_paused:
        return {"sent": False, "reason": "lead_paused_or_missing"}
    if lead.stage not in (policy.allowed_stages or []):
        return {"sent": False, "reason": "stage_not_allowed"}
    from app.services.group_reply import evaluate_group_auto_reply, lead_looks_like_group

    if lead_looks_like_group(lead):
        allow_group, group_reason = evaluate_group_auto_reply(policy, message)
        if not allow_group:
            return {"sent": False, "reason": group_reason}

    result = generate_reply(db, org_id=auth.org.id, lead=lead, message=message)

    from app.models import LeadAccountLink, MessageDirection, OutboundJob, OutboundStatus, SenderType
    from app.services.queue import enqueue as enqueue_job
    from app.workers.runner import _outbound_target

    link = (
        db.query(LeadAccountLink)
        .filter(
            LeadAccountLink.org_id == auth.org.id,
            LeadAccountLink.lead_id == lead_id,
            LeadAccountLink.account_id == account_id,
        )
        .first()
    )
    target = _outbound_target(lead, link)

    from app.services.wa_jid import resolve_target_jid

    job = OutboundJob(
        org_id=auth.org.id,
        account_id=account_id,
        lead_id=lead_id,
        target_name=target,
        target_jid=resolve_target_jid(lead, link),
        body=result["reply"],
        sender_type=SenderType.ai,
        created_by_id=auth.user.id,
        status=OutboundStatus.queued,
    )
    db.add(job)
    db.add(
        Message(
            org_id=auth.org.id,
            account_id=account_id,
            lead_id=lead_id,
            direction=MessageDirection.outbound,
            sender_type=SenderType.ai,
            body=result["reply"],
        )
    )
    db.commit()
    db.refresh(job)
    try:
        from app.services.sse_hub import publish_job_ready

        publish_job_ready(
            account_id, job_id=job.id, reason="ai_suggest_send", org_id=auth.org.id
        )
    except Exception:  # noqa: BLE001
        pass
    enqueue_job("outbound_send", {"job_id": job.id, "org_id": auth.org.id})
    return {
        "sent": True,
        "job_id": job.id,
        "confidence": result["confidence"],
        "provider": result.get("provider"),
    }
