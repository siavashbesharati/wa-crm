"""Thin /whatsapp aliases that force channel=whatsapp for one-release compatibility."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import MemberRole
from app.routers import channels
from app.schemas import ChannelAccountIn, ChannelAccountOut, HeartbeatIn

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


@router.get("/accounts", response_model=list[ChannelAccountOut])
def list_accounts(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    return channels.list_accounts(channel="whatsapp", auth=auth, db=db)


@router.post("/accounts", response_model=ChannelAccountOut)
def create_account(
    body: ChannelAccountIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    forced = ChannelAccountIn(
        channel="whatsapp",
        label=body.label,
        external_id=body.external_id or body.phone,
        phone=body.phone or body.external_id,
    )
    return channels.create_account(body=forced, auth=auth, db=db)


@router.post("/heartbeat")
def heartbeat(body: HeartbeatIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    return channels.heartbeat(body=body, auth=auth, db=db)


@router.get("/sessions")
def list_sessions(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    return channels.list_sessions(auth=auth, db=db)


@router.post("/jobs/claim")
def claim_jobs(
    account_id: str,
    device_id: str,
    limit: int = 5,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    return channels.claim_jobs(
        account_id=account_id, device_id=device_id, limit=limit, auth=auth, db=db
    )


@router.post("/jobs/{job_id}/complete")
def complete_job(
    job_id: str,
    ok: bool = True,
    error: str = "",
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    return channels.complete_job(job_id=job_id, ok=ok, error=error, auth=auth, db=db)
