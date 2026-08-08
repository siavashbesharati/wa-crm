from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import AiPolicy, KnowledgeDoc, Lead, MemberRole, Message
from app.schemas import AiPolicyIn, KnowledgeIn, SuggestIn, SuggestOut
from app.services.ai_reply import generate_reply, retrieve_knowledge
from app.services.embeddings import chunk_text, embed_text
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
    # Soft-migrate stock defaults only (0.55 platform / 0.72 legacy)
    mc = round(float(policy.min_confidence or 0), 2)
    if mc in (0.55, 0.72):
        policy.min_confidence = 0.45
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
        "agent_role": getattr(policy, "agent_role", "") or "",
        "system_prompt": getattr(policy, "system_prompt", "") or "",
        "plan_allows_auto": True,
        "plan_allows_suggest": True,
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
    policy.agent_role = (body.agent_role or "").strip()
    policy.system_prompt = (body.system_prompt or "").strip()
    db.add(policy)
    db.commit()
    return {"ok": True}


@router.get("/knowledge")
def list_docs(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    docs = (
        db.query(KnowledgeDoc)
        .filter(KnowledgeDoc.org_id == auth.org.id)
        .order_by(KnowledgeDoc.created_at.desc())
        .all()
    )
    return [
        {"id": d.id, "title": d.title, "source": d.source, "created_at": d.created_at.isoformat()}
        for d in docs
    ]


@router.post("/knowledge")
def upload_knowledge(
    body: KnowledgeIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    from app.models import KnowledgeChunk

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

    result = generate_reply(db, org_id=auth.org.id, lead=lead, message=message)
    if float(result["confidence"]) < policy.min_confidence:
        return {
            "sent": False,
            "reason": "low_confidence",
            "confidence": result["confidence"],
        }

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

    job = OutboundJob(
        org_id=auth.org.id,
        account_id=account_id,
        lead_id=lead_id,
        target_name=target,
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
    enqueue_job("outbound_send", {"job_id": job.id, "org_id": auth.org.id})
    return {
        "sent": True,
        "job_id": job.id,
        "confidence": result["confidence"],
        "provider": result.get("provider"),
    }
