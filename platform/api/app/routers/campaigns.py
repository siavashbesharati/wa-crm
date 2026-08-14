"""One-shot nurture campaigns from CRM segments."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import Campaign, CampaignSend, ChannelAccount, Lead, MemberRole
from app.schemas import CampaignIn, CampaignOut, CampaignSegmentIn
from app.services.crm_taxonomy import filter_tags
from app.services.queue import enqueue

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


def _segment_dict(seg: CampaignSegmentIn | dict | None) -> dict:
    if isinstance(seg, CampaignSegmentIn):
        return {
            "tags": filter_tags(seg.tags),
            "stages": [s for s in (seg.stages or []) if str(s).strip()],
            "min_score": float(seg.min_score or 0),
            "include_groups": bool(seg.include_groups),
        }
    data = seg or {}
    return {
        "tags": filter_tags(list(data.get("tags") or [])),
        "stages": [s for s in (data.get("stages") or []) if str(s).strip()],
        "min_score": float(data.get("min_score") or 0),
        "include_groups": bool(data.get("include_groups")),
    }


def _match_segment(lead: Lead, seg: dict) -> bool:
    """Return True if lead belongs in the campaign audience.

    Note: bot_paused is intentionally NOT excluded — nurture sends are
    deliberate outreach and must still reach paused chats.
    """
    if (lead.chat_type or "").lower() == "group" and not seg.get("include_groups"):
        return False
    stages = [str(s).strip() for s in (seg.get("stages") or []) if str(s).strip()]
    if stages and (lead.stage or "").strip() not in stages:
        return False
    min_score = float(seg.get("min_score") or 0)
    if float(getattr(lead, "lead_score", 0) or 0) < min_score:
        return False
    want_tags = set(seg.get("tags") or [])
    if want_tags:
        have = set(lead.tags or [])
        if not want_tags.intersection(have):
            return False
    return True


def _audience_count(db: Session, org_id: str, seg: dict) -> int:
    leads = db.query(Lead).filter(Lead.org_id == org_id).all()
    return sum(1 for l in leads if _match_segment(l, seg))


def _send_counts(db: Session, campaign_id: str) -> dict[str, int]:
    rows = db.query(CampaignSend).filter(CampaignSend.campaign_id == campaign_id).all()
    out = {
        "sends_total": len(rows),
        "sends_queued": 0,
        "sends_sent": 0,
        "sends_failed": 0,
        "sends_skipped": 0,
        "sends_pending": 0,
    }
    for r in rows:
        key = f"sends_{r.status}"
        if key in out:
            out[key] += 1
        elif r.status == "pending":
            out["sends_pending"] += 1
    return out


def _to_out(db: Session, camp: Campaign) -> CampaignOut:
    counts = _send_counts(db, camp.id)
    seg = dict(camp.segment_json or {})
    return CampaignOut(
        id=camp.id,
        name=camp.name,
        status=camp.status,
        segment=seg,
        message_template=camp.message_template or "",
        channel_account_id=camp.channel_account_id,
        created_at=camp.created_at,
        updated_at=camp.updated_at,
        started_at=camp.started_at,
        finished_at=camp.finished_at,
        sends_total=counts["sends_total"],
        sends_queued=counts["sends_queued"] + counts.get("sends_pending", 0),
        sends_sent=counts["sends_sent"],
        sends_failed=counts["sends_failed"],
        sends_skipped=counts["sends_skipped"],
        audience_count=_audience_count(db, camp.org_id, seg),
    )


@router.get("", response_model=list[CampaignOut])
def list_campaigns(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    rows = (
        db.query(Campaign)
        .filter(Campaign.org_id == auth.org.id)
        .order_by(Campaign.created_at.desc())
        .limit(100)
        .all()
    )
    return [_to_out(db, r) for r in rows]


@router.post("", response_model=CampaignOut)
def create_campaign(
    body: CampaignIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="نام کمپین الزامی است")
    tpl = (body.message_template or "").strip()
    if not tpl:
        raise HTTPException(status_code=400, detail="متن پیام الزامی است")
    if body.channel_account_id:
        acc = (
            db.query(ChannelAccount)
            .filter(
                ChannelAccount.id == body.channel_account_id,
                ChannelAccount.org_id == auth.org.id,
            )
            .first()
        )
        if not acc:
            raise HTTPException(status_code=404, detail="اکانت کانال یافت نشد")
    camp = Campaign(
        org_id=auth.org.id,
        name=name,
        status="draft",
        segment_json=_segment_dict(body.segment),
        message_template=tpl,
        channel_account_id=body.channel_account_id,
        created_by_id=auth.user.id,
    )
    db.add(camp)
    db.commit()
    db.refresh(camp)
    return _to_out(db, camp)


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(
    campaign_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    camp = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.org_id == auth.org.id)
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="کمپین یافت نشد")
    return _to_out(db, camp)


@router.post("/{campaign_id}/preview")
def preview_campaign(
    campaign_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    camp = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.org_id == auth.org.id)
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="کمپین یافت نشد")
    seg = camp.segment_json or {}
    leads = db.query(Lead).filter(Lead.org_id == auth.org.id).all()
    matched = [l for l in leads if _match_segment(l, seg)]
    return {
        "count": len(matched),
        "sample": [
            {
                "id": l.id,
                "name": l.name,
                "stage": l.stage,
                "tags": l.tags or [],
                "lead_score": float(getattr(l, "lead_score", 0) or 0),
            }
            for l in matched[:20]
        ],
    }


@router.post("/{campaign_id}/start", response_model=CampaignOut)
def start_campaign(
    campaign_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    camp = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.org_id == auth.org.id)
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="کمپین یافت نشد")
    if camp.status in ("running", "queued"):
        raise HTTPException(status_code=400, detail="کمپین در حال اجراست")
    if not (camp.message_template or "").strip():
        raise HTTPException(status_code=400, detail="متن پیام خالی است")
    if not camp.channel_account_id:
        raise HTTPException(status_code=400, detail="اکانت کانال انتخاب نشده")

    # Clear previous sends if restarting a done/paused campaign
    db.query(CampaignSend).filter(CampaignSend.campaign_id == camp.id).delete(
        synchronize_session=False
    )

    seg = camp.segment_json or {}
    leads = db.query(Lead).filter(Lead.org_id == auth.org.id).all()
    matched = [l for l in leads if _match_segment(l, seg)]
    if not matched:
        raise HTTPException(status_code=400, detail="هیچ مخاطبی با این فیلتر پیدا نشد")

    for lead in matched:
        db.add(
            CampaignSend(
                org_id=auth.org.id,
                campaign_id=camp.id,
                lead_id=lead.id,
                status="pending",
            )
        )

    camp.status = "running"
    camp.started_at = datetime.utcnow()
    camp.finished_at = None
    db.add(camp)
    db.commit()
    enqueue("campaign_send", {"campaign_id": camp.id, "org_id": auth.org.id})
    # Also kick worker path in-process for local/dev without separate worker
    try:
        from app.workers.runner import handle_campaign_send

        handle_campaign_send({"campaign_id": camp.id, "org_id": auth.org.id})
    except Exception:  # noqa: BLE001
        pass
    db.refresh(camp)
    return _to_out(db, camp)


@router.post("/{campaign_id}/pause", response_model=CampaignOut)
def pause_campaign(
    campaign_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    camp = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.org_id == auth.org.id)
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="کمپین یافت نشد")
    camp.status = "paused"
    db.add(camp)
    db.commit()
    db.refresh(camp)
    return _to_out(db, camp)


@router.delete("/{campaign_id}")
def delete_campaign(
    campaign_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    camp = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.org_id == auth.org.id)
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="کمپین یافت نشد")
    db.query(CampaignSend).filter(CampaignSend.campaign_id == camp.id).delete(
        synchronize_session=False
    )
    db.delete(camp)
    db.commit()
    return {"ok": True}
