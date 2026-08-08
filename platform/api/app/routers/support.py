"""Business support ticketing API."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import MemberRole, SupportMessage, SupportTicket, User

router = APIRouter(prefix="/support", tags=["support"])

CATEGORIES = {"general", "billing", "technical", "ai"}
STATUSES = {"open", "in_progress", "resolved", "closed"}
PRIORITIES = {"low", "normal", "high"}


class TicketCreateIn(BaseModel):
    subject: str = Field(min_length=3, max_length=240)
    body: str = Field(min_length=5)
    category: str = "general"
    priority: str = "normal"


class TicketMessageIn(BaseModel):
    body: str = Field(min_length=1)


def _user_name(db: Session, user_id: str | None) -> str:
    if not user_id:
        return "—"
    u = db.get(User, user_id)
    if not u:
        return "—"
    return u.display_name or u.phone or "—"


def _ticket_out(db: Session, t: SupportTicket, *, with_messages: bool = False) -> dict:
    out = {
        "id": t.id,
        "org_id": t.org_id,
        "subject": t.subject,
        "category": t.category,
        "status": t.status,
        "priority": t.priority,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        "user_name": _user_name(db, t.user_id),
        "message_count": len(t.messages or []),
    }
    if with_messages:
        out["messages"] = [
            {
                "id": m.id,
                "sender_side": m.sender_side,
                "body": m.body,
                "user_name": _user_name(db, m.user_id),
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in (t.messages or [])
        ]
    return out


@router.get("/tickets")
def list_tickets(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    rows = (
        db.query(SupportTicket)
        .options(joinedload(SupportTicket.messages))
        .filter(SupportTicket.org_id == auth.org.id)
        .order_by(SupportTicket.updated_at.desc())
        .all()
    )
    return {"tickets": [_ticket_out(db, t) for t in rows]}


@router.post("/tickets")
def create_ticket(
    body: TicketCreateIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    cat = (body.category or "general").strip().lower()
    if cat not in CATEGORIES:
        cat = "general"
    pri = (body.priority or "normal").strip().lower()
    if pri not in PRIORITIES:
        pri = "normal"

    ticket = SupportTicket(
        org_id=auth.org.id,
        user_id=auth.user.id,
        subject=body.subject.strip(),
        category=cat,
        priority=pri,
        status="open",
    )
    db.add(ticket)
    db.flush()
    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            user_id=auth.user.id,
            sender_side="business",
            body=body.body.strip(),
        )
    )
    ticket.updated_at = datetime.utcnow()
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    ticket = (
        db.query(SupportTicket)
        .options(joinedload(SupportTicket.messages))
        .filter(SupportTicket.id == ticket.id)
        .first()
    )
    return {"ok": True, "ticket": _ticket_out(db, ticket, with_messages=True)}


@router.get("/tickets/{ticket_id}")
def get_ticket(
    ticket_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    ticket = (
        db.query(SupportTicket)
        .options(joinedload(SupportTicket.messages))
        .filter(SupportTicket.id == ticket_id, SupportTicket.org_id == auth.org.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="تیکت یافت نشد")
    return _ticket_out(db, ticket, with_messages=True)


@router.post("/tickets/{ticket_id}/messages")
def reply_ticket(
    ticket_id: str,
    body: TicketMessageIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    ticket = (
        db.query(SupportTicket)
        .filter(SupportTicket.id == ticket_id, SupportTicket.org_id == auth.org.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="تیکت یافت نشد")
    if ticket.status == "closed":
        raise HTTPException(status_code=400, detail="تیکت بسته شده است")

    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            user_id=auth.user.id,
            sender_side="business",
            body=body.body.strip(),
        )
    )
    if ticket.status in ("resolved",):
        ticket.status = "open"
    ticket.updated_at = datetime.utcnow()
    db.add(ticket)
    db.commit()
    ticket = (
        db.query(SupportTicket)
        .options(joinedload(SupportTicket.messages))
        .filter(SupportTicket.id == ticket.id)
        .first()
    )
    return {"ok": True, "ticket": _ticket_out(db, ticket, with_messages=True)}
