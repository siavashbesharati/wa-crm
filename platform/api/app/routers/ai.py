from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import AiPolicy, KnowledgeChunk, KnowledgeDoc, Lead, MemberRole, Message
from app.plans import plan_limits
from app.schemas import AiPolicyIn, KnowledgeIn, SuggestIn, SuggestOut
from app.services.embeddings import chunk_text, cosine, embed_text
from app.services.queue import enqueue

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/policy")
def get_policy(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == auth.org.id).first()
    if not policy:
        policy = AiPolicy(org_id=auth.org.id)
        db.add(policy)
        db.commit()
        db.refresh(policy)
    return {
        "auto_send_enabled": policy.auto_send_enabled,
        "min_confidence": policy.min_confidence,
        "allowed_stages": policy.allowed_stages or [],
        "business_hours_only": policy.business_hours_only,
        "hours_start": policy.hours_start,
        "hours_end": policy.hours_end,
        "plan_allows_auto": plan_limits(auth.org.plan)["ai_auto_send"],
        "plan_allows_suggest": plan_limits(auth.org.plan)["ai_suggest"],
    }


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
    policy.min_confidence = body.min_confidence
    policy.allowed_stages = body.allowed_stages
    policy.business_hours_only = body.business_hours_only
    policy.hours_start = body.hours_start
    policy.hours_end = body.hours_end
    db.add(policy)
    db.commit()
    return {"ok": True}


@router.get("/knowledge")
def list_docs(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    docs = db.query(KnowledgeDoc).filter(KnowledgeDoc.org_id == auth.org.id).order_by(KnowledgeDoc.created_at.desc()).all()
    return [{"id": d.id, "title": d.title, "source": d.source, "created_at": d.created_at.isoformat()} for d in docs]


@router.post("/knowledge")
def upload_knowledge(
    body: KnowledgeIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
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
    enqueue("embed", {"doc_id": doc.id, "org_id": auth.org.id})
    return {"ok": True, "doc_id": doc.id}


def retrieve(db: Session, org_id: str, query: str, k: int = 4) -> list[tuple[KnowledgeChunk, float]]:
    qv = embed_text(query)
    chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.org_id == org_id).all()
    scored = [(c, cosine(qv, c.embedding or [])) for c in chunks]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]


@router.post("/suggest", response_model=SuggestOut)
def suggest(body: SuggestIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    if not plan_limits(auth.org.plan)["ai_suggest"]:
        raise HTTPException(status_code=402, detail="پلن شما پیشنهاد AI ندارد")

    lead = db.query(Lead).filter(Lead.id == body.lead_id, Lead.org_id == auth.org.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="لید یافت نشد")

    hits = retrieve(db, auth.org.id, body.message)
    if not hits or hits[0][1] < 0.05:
        return SuggestOut(
            reply="سلام، پیام شما دریافت شد. همکاران ما به‌زودی پاسخ می‌دهند.",
            confidence=0.2,
            sources=[],
        )

    top = hits[0]
    reply = (
        f"سلام {lead.name or ''}".strip()
        + "،\n"
        + top[0].content[:500]
        + "\n\nاگر سوال دیگری دارید بفرمایید."
    )
    return SuggestOut(
        reply=reply,
        confidence=round(float(top[1]), 3),
        sources=[h[0].content[:120] for h in hits if h[1] > 0.05],
    )


@router.post("/auto-reply/run")
def run_auto_reply_for_lead(
    lead_id: str,
    message: str,
    account_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    """Manual trigger used by workers/tests; respects policy + plan."""
    limits = plan_limits(auth.org.plan)
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == auth.org.id).first()
    if not limits["ai_auto_send"] or not policy or not policy.auto_send_enabled:
        return {"sent": False, "reason": "auto_send_disabled"}

    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == auth.org.id).first()
    if not lead or lead.bot_paused:
        return {"sent": False, "reason": "lead_paused_or_missing"}
    if lead.stage not in (policy.allowed_stages or []):
        return {"sent": False, "reason": "stage_not_allowed"}

    suggestion = suggest(SuggestIn(lead_id=lead_id, message=message), auth, db)
    if suggestion.confidence < policy.min_confidence:
        return {"sent": False, "reason": "low_confidence", "confidence": suggestion.confidence}

    from app.models import MessageDirection, OutboundJob, OutboundStatus, SenderType
    from app.services.queue import enqueue as enqueue_job

    job = OutboundJob(
        org_id=auth.org.id,
        account_id=account_id,
        lead_id=lead_id,
        target_name=lead.name,
        body=suggestion.reply,
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
            body=suggestion.reply,
        )
    )
    db.commit()
    db.refresh(job)
    enqueue_job("outbound_send", {"job_id": job.id, "org_id": auth.org.id})
    return {"sent": True, "job_id": job.id, "confidence": suggestion.confidence}
