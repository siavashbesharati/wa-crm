from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth
from app.models import Lead, LeadAccountLink, MemberRole
from app.schemas import LeadIn, LeadOut, LeadPatchIn

router = APIRouter(prefix="/leads", tags=["leads"])

STAGES = ["جدید", "پیگیری", "پیشنهاد", "خرید", "بسته"]


def _to_out(lead: Lead) -> LeadOut:
    return LeadOut(
        id=lead.id,
        name=lead.name,
        phone=lead.phone or "",
        group_id=lead.group_id or "",
        chat_type=lead.chat_type,
        stage=lead.stage,
        tags=lead.tags or [],
        notes=lead.notes or "",
        assignee_id=lead.assignee_id,
        bot_paused=lead.bot_paused,
        last_message_at=lead.last_message_at,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


@router.get("/stages")
def stages():
    return {"stages": STAGES}


@router.get("", response_model=list[LeadOut])
def list_leads(
    stage: str | None = None,
    q: str | None = None,
    assignee_id: str | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    query = db.query(Lead).filter(Lead.org_id == auth.org.id)
    if stage:
        query = query.filter(Lead.stage == stage)
    if assignee_id:
        query = query.filter(Lead.assignee_id == assignee_id)
    if q:
        like = f"%{q}%"
        query = query.filter((Lead.name.ilike(like)) | (Lead.phone.ilike(like)) | (Lead.notes.ilike(like)))
    rows = query.order_by(Lead.updated_at.desc()).limit(500).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=LeadOut)
def create_lead(body: LeadIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    lead = Lead(
        org_id=auth.org.id,
        name=body.name.strip(),
        phone=body.phone,
        group_id=body.group_id,
        chat_type=body.chat_type,
        stage=body.stage or STAGES[0],
        tags=body.tags,
        notes=body.notes,
        assignee_id=body.assignee_id,
        bot_paused=body.bot_paused,
        last_message_at=datetime.utcnow(),
    )
    db.add(lead)
    db.flush()
    if body.account_id:
        db.add(
            LeadAccountLink(
                org_id=auth.org.id,
                lead_id=lead.id,
                account_id=body.account_id,
                chat_name=body.chat_name or body.name,
            )
        )
    db.commit()
    db.refresh(lead)
    return _to_out(lead)


@router.patch("/{lead_id}", response_model=LeadOut)
def patch_lead(
    lead_id: str,
    body: LeadPatchIn,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == auth.org.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="لید یافت نشد")
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(lead, key, value)
    lead.updated_at = datetime.utcnow()
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return _to_out(lead)


@router.post("/{lead_id}/assign", response_model=LeadOut)
def assign_lead(
    lead_id: str,
    assignee_id: str | None = Query(default=None),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    if auth.role == MemberRole.viewer:
        raise HTTPException(status_code=403, detail="دسترسی کافی نیست")
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == auth.org.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="لید یافت نشد")
    lead.assignee_id = assignee_id
    lead.updated_at = datetime.utcnow()
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return _to_out(lead)
