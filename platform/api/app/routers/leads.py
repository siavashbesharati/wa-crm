from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import Lead, LeadAccountLink, MemberRole, Message, OutboundJob, Task
from app.schemas import LeadBoardReorderIn, LeadIn, LeadOut, LeadPatchIn

router = APIRouter(prefix="/leads", tags=["leads"])

STAGES = ["جدید", "پیگیری", "پیشنهاد", "خرید", "بسته"]
_PHONE_RE = re.compile(r"^\+?\d{8,15}$")


def _sanitize_phone(value: str | None, *, chat_type: str = "pv") -> str:
    if (chat_type or "").strip().lower() == "group":
        return ""
    t = re.sub(r"[\s\-()]", "", str(value or "").strip())
    if not t:
        return ""
    if _PHONE_RE.match(t):
        return t
    # Allow opaque Divar ids; reject WA display names (letters / Persian, no digit-only)
    if re.search(r"[\u0600-\u06FF]", t) or (re.search(r"[A-Za-z]", t) and not re.search(r"\d", t)):
        return ""
    if not any(ch.isdigit() for ch in t) and len(t) < 20:
        return ""
    return str(value or "").strip()


def _delete_lead_related(db: Session, *, org_id: str, lead_id: str) -> None:
    """Remove dependent rows before deleting the lead (SQLite has no ON DELETE CASCADE)."""
    db.query(OutboundJob).filter(
        OutboundJob.org_id == org_id, OutboundJob.lead_id == lead_id
    ).delete(synchronize_session=False)
    db.query(Message).filter(Message.org_id == org_id, Message.lead_id == lead_id).delete(
        synchronize_session=False
    )
    db.query(LeadAccountLink).filter(
        LeadAccountLink.org_id == org_id, LeadAccountLink.lead_id == lead_id
    ).delete(synchronize_session=False)
    db.query(Task).filter(Task.org_id == org_id, Task.lead_id == lead_id).update(
        {Task.lead_id: None}, synchronize_session=False
    )


def _to_out(lead: Lead) -> LeadOut:
    return LeadOut(
        id=lead.id,
        name=lead.name,
        phone=lead.phone or "",
        group_id=lead.group_id or "",
        external_chat_id=lead.external_chat_id,
        post_token=lead.post_token or "",
        source_channel=lead.source_channel or "",
        chat_type=lead.chat_type,
        stage=lead.stage,
        board_order=int(getattr(lead, "board_order", 0) or 0),
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
    chat_type: str | None = None,
    source_channel: str | None = None,
    unassigned: bool | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    query = db.query(Lead).filter(Lead.org_id == auth.org.id)
    if stage:
        query = query.filter(Lead.stage == stage)
    if unassigned:
        query = query.filter(Lead.assignee_id.is_(None))
    elif assignee_id:
        query = query.filter(Lead.assignee_id == assignee_id)
    if chat_type:
        ct = chat_type.strip().lower()
        if ct == "group":
            query = query.filter(Lead.chat_type == "group")
        elif ct in ("pv", "contact"):
            query = query.filter(Lead.chat_type != "group")
    if source_channel:
        sc = source_channel.strip().lower()
        if sc == "__none__":
            query = query.filter((Lead.source_channel.is_(None)) | (Lead.source_channel == ""))
        else:
            query = query.filter(Lead.source_channel == sc)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (Lead.name.ilike(like))
            | (Lead.phone.ilike(like))
            | (Lead.notes.ilike(like))
            | (Lead.external_chat_id.ilike(like))
        )
    rows = query.limit(500).all()
    stage_rank = {s: i for i, s in enumerate(STAGES)}

    def sort_key(lead: Lead) -> tuple:
        return (
            stage_rank.get(lead.stage, len(STAGES)),
            int(getattr(lead, "board_order", 0) or 0),
            -(lead.updated_at.timestamp() if lead.updated_at else 0),
        )

    rows.sort(key=sort_key)
    return [_to_out(r) for r in rows]


@router.post("", response_model=LeadOut)
def create_lead(body: LeadIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    name = body.name.strip()
    external_chat_id = (body.external_chat_id or "").strip() or None
    chat_type = (body.chat_type or "pv").strip().lower() or "pv"
    if chat_type != "group":
        chat_type = "pv"
    phone = _sanitize_phone(body.phone, chat_type=chat_type)
    lead = None
    if external_chat_id:
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == auth.org.id, Lead.external_chat_id == external_chat_id)
            .first()
        )
    if not lead and phone:
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == auth.org.id, Lead.phone == phone)
            .first()
        )
    if not lead and body.group_id:
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == auth.org.id, Lead.group_id == body.group_id)
            .first()
        )
    if not lead and name:
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == auth.org.id, Lead.name == name)
            .first()
        )

    if lead:
        lead.name = name or lead.name
        if phone:
            lead.phone = phone
        elif chat_type == "group":
            lead.phone = ""
        if body.group_id:
            lead.group_id = body.group_id
        if external_chat_id:
            lead.external_chat_id = external_chat_id
        if body.post_token:
            lead.post_token = body.post_token
        if body.source_channel:
            lead.source_channel = body.source_channel
        lead.chat_type = chat_type or lead.chat_type
        if body.stage:
            lead.stage = body.stage
        if body.tags is not None:
            lead.tags = body.tags
        if body.notes:
            lead.notes = body.notes
        if body.assignee_id is not None:
            lead.assignee_id = body.assignee_id
        if body.bot_paused is not None:
            lead.bot_paused = body.bot_paused
        lead.last_message_at = datetime.utcnow()
        lead.updated_at = datetime.utcnow()
        db.add(lead)
    else:
        lead = Lead(
            org_id=auth.org.id,
            name=name,
            phone=phone,
            group_id=body.group_id,
            external_chat_id=external_chat_id,
            post_token=body.post_token or "",
            source_channel=body.source_channel or "",
            chat_type=chat_type,
            stage=body.stage or STAGES[0],
            tags=body.tags,
            notes=body.notes,
            assignee_id=body.assignee_id,
            bot_paused=bool(body.bot_paused) if body.bot_paused is not None else False,
            last_message_at=datetime.utcnow(),
        )
        db.add(lead)
        db.flush()

    if body.account_id:
        chat_name = body.chat_name or body.name
        exists = None
        if external_chat_id:
            exists = (
                db.query(LeadAccountLink)
                .filter(
                    LeadAccountLink.org_id == auth.org.id,
                    LeadAccountLink.account_id == body.account_id,
                    LeadAccountLink.external_chat_id == external_chat_id,
                )
                .first()
            )
        if not exists:
            exists = (
                db.query(LeadAccountLink)
                .filter(
                    LeadAccountLink.org_id == auth.org.id,
                    LeadAccountLink.account_id == body.account_id,
                    LeadAccountLink.chat_name == chat_name,
                )
                .first()
            )
        if not exists:
            safe_ext = external_chat_id
            safe_name = chat_name or ""
            if safe_ext:
                clash = (
                    db.query(LeadAccountLink)
                    .filter(
                        LeadAccountLink.org_id == auth.org.id,
                        LeadAccountLink.account_id == body.account_id,
                        LeadAccountLink.external_chat_id == safe_ext,
                    )
                    .first()
                )
                if clash:
                    clash.lead_id = lead.id
                    if safe_name and not clash.chat_name:
                        clash.chat_name = safe_name
                    db.add(clash)
                    safe_ext = None
                    exists = clash
            if not exists:
                name_clash = (
                    db.query(LeadAccountLink)
                    .filter(
                        LeadAccountLink.org_id == auth.org.id,
                        LeadAccountLink.account_id == body.account_id,
                        LeadAccountLink.chat_name == safe_name,
                    )
                    .first()
                    if safe_name
                    else None
                )
                if name_clash:
                    name_clash.lead_id = lead.id
                    if safe_ext and not name_clash.external_chat_id:
                        name_clash.external_chat_id = safe_ext
                    db.add(name_clash)
                else:
                    db.add(
                        LeadAccountLink(
                            org_id=auth.org.id,
                            lead_id=lead.id,
                            account_id=body.account_id,
                            chat_name=safe_name,
                            external_chat_id=safe_ext,
                        )
                    )
    db.commit()
    db.refresh(lead)
    return _to_out(lead)


@router.patch("/{lead_id}", response_model=LeadOut)
def patch_lead(
    lead_id: str,
    body: LeadPatchIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == auth.org.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="لید یافت نشد")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        data["name"] = str(data["name"]).strip() or lead.name
    if "chat_type" in data and data["chat_type"] is not None:
        ct = str(data["chat_type"]).strip().lower() or "pv"
        data["chat_type"] = "group" if ct == "group" else "pv"
    if "phone" in data and data["phone"] is not None:
        ct = data.get("chat_type") or lead.chat_type or "pv"
        data["phone"] = _sanitize_phone(str(data["phone"]).strip(), chat_type=str(ct))
    if "notes" in data and data["notes"] is not None:
        data["notes"] = str(data["notes"])
    for key, value in data.items():
        setattr(lead, key, value)
    lead.updated_at = datetime.utcnow()
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return _to_out(lead)


@router.post("/board-order")
def update_board_order(
    body: LeadBoardReorderIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    if not body.updates:
        return {"ok": True}
    ids = [u.id for u in body.updates]
    rows = db.query(Lead).filter(Lead.org_id == auth.org.id, Lead.id.in_(ids)).all()
    by_id = {r.id: r for r in rows}
    now = datetime.utcnow()
    for item in body.updates:
        lead = by_id.get(item.id)
        if not lead:
            continue
        if item.stage in STAGES:
            lead.stage = item.stage
        lead.board_order = int(item.board_order)
        lead.updated_at = now
        db.add(lead)
    db.commit()
    return {"ok": True, "updated": len(body.updates)}


@router.delete("/clear-all")
def clear_all_leads(
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    """Delete every lead in the org (and related messages / jobs / links)."""
    leads = db.query(Lead).filter(Lead.org_id == auth.org.id).all()
    deleted = 0
    for lead in leads:
        _delete_lead_related(db, org_id=auth.org.id, lead_id=lead.id)
        db.delete(lead)
        deleted += 1
    db.commit()
    return {"ok": True, "deleted": deleted}


@router.delete("/{lead_id}")
def delete_lead(
    lead_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.org_id == auth.org.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="لید یافت نشد")
    _delete_lead_related(db, org_id=auth.org.id, lead_id=lead.id)
    db.delete(lead)
    db.commit()
    return {"ok": True, "id": lead_id}


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
