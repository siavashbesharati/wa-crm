"""One-shot nurture campaigns from CRM segments."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from statistics import median

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import (
    AiEvent,
    Campaign,
    CampaignSend,
    ChannelAccount,
    Lead,
    MemberRole,
    Message,
    MessageDirection,
    SenderType,
)
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
    from app.services.campaign_send import reconcile_campaign

    # Heal counts + flip to done when all sends finished (survives missed complete hooks)
    if reconcile_campaign(db, camp.id):
        db.commit()
        db.refresh(camp)
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
    from app.services.campaign_send import org_has_active_campaign, reconcile_campaign

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

    # Heal any stuck "running" campaigns before checking the lock
    for other in (
        db.query(Campaign)
        .filter(
            Campaign.org_id == auth.org.id,
            Campaign.status.in_(("running", "queued")),
        )
        .all()
    ):
        if reconcile_campaign(db, other.id):
            db.commit()

    blocking = org_has_active_campaign(db, auth.org.id, exclude_id=camp.id)
    if blocking:
        raise HTTPException(
            status_code=400,
            detail=f"تا پایان کمپین «{blocking.name}» نمی‌توانید کمپین دیگری شروع کنید",
        )

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


# ---------------------------------------------------------------------------
# Campaign report — KPI summary, funnel, timeline, top leads
# ---------------------------------------------------------------------------

# Funnel labels used by the report. These match the stages the CRM actually
# stores (see seed_demo_full.py LEADS list and the leads router defaults).
REPORT_FUNNEL = ("جدید", "پیگیری", "بازدید", "مذاکره", "بسته‌شده")
TERMINAL_FUNNEL_STAGE = "بسته‌شده"  # "won" — stage that counts as a conversion


def _pct(part: int, whole: int) -> float:
    if not whole:
        return 0.0
    return round((part / whole) * 100, 1)


def _channel_label(db: Session, camp: Campaign) -> str:
    if not camp.channel_account_id:
        return ""
    acc = db.get(ChannelAccount, camp.channel_account_id)
    if not acc:
        return ""
    return (acc.label or "").strip() or acc.external_id or "—"


def _build_campaign_report(db: Session, camp: Campaign) -> dict:
    """Compose a comprehensive report for a single campaign.

    All numbers are derived live from CampaignSend / Message / Lead / AiEvent
    so the report always reflects the current DB state — no denormalized
    counters to drift.
    """
    from app.services.campaign_send import reconcile_campaign

    # Heal before reporting (also flips stuck campaigns to done)
    if reconcile_campaign(db, camp.id):
        db.commit()
        db.refresh(camp)

    seg = dict(camp.segment_json or {})

    # 1) Send breakdown by status
    send_rows = (
        db.query(CampaignSend).filter(CampaignSend.campaign_id == camp.id).all()
    )
    by_status: dict[str, int] = {
        "pending": 0, "queued": 0, "sent": 0, "failed": 0, "skipped": 0,
    }
    for r in send_rows:
        by_status[r.status if r.status in by_status else "pending"] += 1
    sends_total = len(send_rows)
    sends_sent = by_status["sent"]
    sends_failed = by_status["failed"]
    sends_open = sends_sent + sends_failed
    delivery_rate = _pct(sends_sent, sends_open)

    # 2) Replied leads (any inbound message after the campaign started)
    sent_lead_ids = [
        r.lead_id for r in send_rows if r.status in ("sent", "delivered", "read")
    ]
    sent_lead_set = set(sent_lead_ids)
    reply_cutoff = camp.started_at or camp.created_at

    inbound_msgs = (
        db.query(Message)
        .filter(
            Message.org_id == camp.org_id,
            Message.direction == MessageDirection.inbound,
            Message.created_at >= reply_cutoff,
            Message.lead_id.in_(sent_lead_set) if sent_lead_set else False,
        )
        .all()
    ) if sent_lead_set else []

    by_lead: dict[str, list[Message]] = {}
    for m in inbound_msgs:
        by_lead.setdefault(m.lead_id, []).append(m)

    replied_lead_ids = set(by_lead.keys())
    replied_count = len(replied_lead_ids)
    reply_rate = _pct(replied_count, sends_sent)

    # 3) AI vs human replies
    ai_replied_leads: set[str] = set()
    for lead_id, msgs in by_lead.items():
        for m in msgs:
            if m.sender_type == SenderType.ai:
                ai_replied_leads.add(lead_id)
                break
    human_replied_leads = replied_lead_ids - ai_replied_leads
    auto_reply_rate = _pct(len(ai_replied_leads), sends_sent)

    # 4) Response time (minutes from campaign start to first inbound reply)
    response_minutes: list[int] = []
    for _lid, msgs in by_lead.items():
        msgs_sorted = sorted(msgs, key=lambda m: m.created_at)
        first = msgs_sorted[0]
        delta = (first.created_at - reply_cutoff).total_seconds() / 60.0
        if 0 <= delta <= 60 * 24 * 30:
            response_minutes.append(int(round(delta)))
    avg_response_minutes = int(round(median(response_minutes))) if response_minutes else None

    # 5) Conversions: leads that moved into terminal stage after the send
    if sent_lead_set:
        converted_leads = (
            db.query(Lead)
            .filter(Lead.id.in_(sent_lead_set), Lead.stage == TERMINAL_FUNNEL_STAGE)
            .all()
        )
    else:
        converted_leads = []
    conversion_count = len(converted_leads)
    conversion_rate = _pct(conversion_count, sends_sent) if sends_sent else 0.0
    conversion_replied_count = sum(1 for l in converted_leads if l.id in replied_lead_ids)

    # 6) Funnel: how many campaign-sent leads are currently in each stage
    if sent_lead_set:
        leads_now = db.query(Lead).filter(Lead.id.in_(sent_lead_set)).all()
    else:
        leads_now = []
    stage_counter = Counter((l.stage or "جدید") for l in leads_now)
    funnel_counts: list[dict] = []
    for stage in REPORT_FUNNEL:
        funnel_counts.append({"stage": stage, "count": int(stage_counter.get(stage, 0))})
    for st, n in stage_counter.items():
        if st not in REPORT_FUNNEL:
            funnel_counts.append({"stage": st, "count": int(n)})

    # 7) Timeline: 14 days of daily sent / replied / converted
    today = datetime.utcnow().date()
    timeline: list[dict] = []
    timeline_lookup: dict[str, dict] = {}
    for i in range(13, -1, -1):
        day = (today - timedelta(days=i)).isoformat()
        rec = {"date": day, "sent": 0, "replied": 0, "converted": 0}
        timeline.append(rec)
        timeline_lookup[day] = rec
    for r in send_rows:
        if r.status == "sent" and r.updated_at:
            day = r.updated_at.date().isoformat()
            if day in timeline_lookup:
                timeline_lookup[day]["sent"] += 1
    for m in inbound_msgs:
        day = m.created_at.date().isoformat()
        if day in timeline_lookup:
            timeline_lookup[day]["replied"] += 1
    for l in converted_leads:
        if l.updated_at:
            day = l.updated_at.date().isoformat()
            if day in timeline_lookup:
                timeline_lookup[day]["converted"] += 1

    # 8) Top leads (sorted: replied first, then highest score)
    leads_for_top = leads_now
    send_status_by_lead = {r.lead_id: r.status for r in send_rows}
    first_reply_by_lead: dict[str, datetime] = {}
    for lead_id, msgs in by_lead.items():
        first_reply_by_lead[lead_id] = min(msgs, key=lambda m: m.created_at).created_at

    def _top_sort_key(lead: Lead):
        return (
            0 if lead.id in replied_lead_ids else 1,
            -float(lead.lead_score or 0),
        )

    top_leads = sorted(leads_for_top, key=_top_sort_key)[:10]
    top_leads_out = []
    for lead in top_leads:
        first_reply = first_reply_by_lead.get(lead.id)
        resp_min: int | None = None
        if first_reply:
            resp_min = int(round((first_reply - reply_cutoff).total_seconds() / 60.0))
            if resp_min < 0:
                resp_min = 0
        top_leads_out.append({
            "lead_id": lead.id,
            "name": lead.name or "—",
            "phone": lead.phone or "",
            "stage": lead.stage or "",
            "lead_score": float(lead.lead_score or 0),
            "send_status": send_status_by_lead.get(lead.id, "—"),
            "replied": lead.id in replied_lead_ids,
            "ai_replied": lead.id in ai_replied_leads,
            "is_conversion": lead.id in {l.id for l in converted_leads},
            "response_minutes": resp_min,
            "tags": list(lead.tags or []),
        })

    # 9) Errors sample
    failed_rows = [r for r in send_rows if r.status == "failed" and r.error]
    failed_rows.sort(key=lambda r: r.updated_at or r.created_at, reverse=True)
    lead_names = {l.id: l.name for l in leads_for_top}
    errors_sample = [
        {
            "lead_id": r.lead_id,
            "name": lead_names.get(r.lead_id, "—"),
            "error": r.error[:240],
        }
        for r in failed_rows[:5]
    ]

    # 10) AI engagement (cross-check via AiEvent rows)
    ai_event_count = 0
    if sent_lead_set:
        ai_event_count = (
            db.query(AiEvent)
            .filter(
                AiEvent.org_id == camp.org_id,
                AiEvent.event_type == "auto_reply",
                AiEvent.lead_id.in_(sent_lead_set),
                AiEvent.created_at >= reply_cutoff,
            )
            .count()
        )

    audience_count = _audience_count(db, camp.org_id, seg)

    return {
        "campaign": {
            "id": camp.id,
            "name": camp.name,
            "status": camp.status,
            "segment": seg,
            "message_template": camp.message_template or "",
            "channel_label": _channel_label(db, camp),
            "started_at": camp.started_at.isoformat() if camp.started_at else None,
            "finished_at": camp.finished_at.isoformat() if camp.finished_at else None,
            "created_at": camp.created_at.isoformat() if camp.created_at else None,
        },
        "summary": {
            "audience": audience_count,
            "sends_total": sends_total,
            "sends_sent": sends_sent,
            "sends_failed": sends_failed,
            "sends_pending": by_status["pending"],
            "sends_queued": by_status["queued"],
            "sends_skipped": by_status["skipped"],
            "delivery_rate": delivery_rate,
            "replied_count": replied_count,
            "reply_rate": reply_rate,
            "human_replied": len(human_replied_leads),
            "automated_replied": len(ai_replied_leads),
            "automated_reply_rate": auto_reply_rate,
            "conversions": conversion_count,
            "conversion_rate": conversion_rate,
            "conversions_from_replies": conversion_replied_count,
            "avg_response_minutes": avg_response_minutes,
        },
        "by_status": by_status,
        "funnel": funnel_counts,
        "timeline": timeline,
        "top_leads": top_leads_out,
        "errors_sample": errors_sample,
        "ai_engagement": {
            "auto_reply_events": ai_event_count,
            "leads_ai_replied": len(ai_replied_leads),
            "leads_human_replied": len(human_replied_leads),
        },
    }


@router.get("/{campaign_id}/report")
def campaign_report(
    campaign_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    """Live KPI / funnel / timeline report for a single campaign.

    Used by the campaign-detail modal on /campaigns. All numbers are derived
    from the same CampaignSend / Message / Lead rows shown on the campaign
    card, so the report counts always match the list counts.
    """
    camp = (
        db.query(Campaign)
        .filter(Campaign.id == campaign_id, Campaign.org_id == auth.org.id)
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="کمپین یافت نشد")
    return _build_campaign_report(db, camp)

