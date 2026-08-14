"""Campaign send helpers: template render + job completion sync."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Campaign, CampaignSend, Lead, OutboundJob, OutboundStatus


def render_campaign_body(template: str, lead: Lead | None) -> str:
    """Replace {{name}} / {{phone}} placeholders for a lead."""
    raw = template or ""
    name = ""
    phone = ""
    if lead:
        name = (lead.name or "").strip()
        phone = (lead.phone or "").strip()
        if not name or name.startswith("~") or name == "کاربر":
            name = phone or "دوست عزیز"
    else:
        name = "دوست عزیز"
    return (
        raw.replace("{{name}}", name)
        .replace("{{Name}}", name)
        .replace("{{NAME}}", name)
        .replace("{{phone}}", phone)
        .replace("{{Phone}}", phone)
    )


def apply_job_result_to_campaign_send(
    db: Session,
    *,
    job_id: str,
    ok: bool,
    error: str = "",
) -> None:
    """Mark CampaignSend sent/failed when its OutboundJob completes; finish campaign if done."""
    jid = (job_id or "").strip()
    if not jid:
        return
    row = db.query(CampaignSend).filter(CampaignSend.job_id == jid).first()
    if not row:
        return
    if row.status in ("sent", "failed", "skipped"):
        _maybe_finish_campaign(db, row.campaign_id)
        return
    row.status = "sent" if ok else "failed"
    row.error = (error or "")[:2000]
    row.updated_at = datetime.utcnow()
    db.add(row)
    _maybe_finish_campaign(db, row.campaign_id)


def sync_campaign_sends_from_jobs(db: Session, campaign_id: str) -> bool:
    """Heal stuck 'queued' rows whose OutboundJob already finished."""
    rows = (
        db.query(CampaignSend)
        .filter(
            CampaignSend.campaign_id == campaign_id,
            CampaignSend.status == "queued",
            CampaignSend.job_id != "",
        )
        .all()
    )
    changed = False
    for row in rows:
        job = db.get(OutboundJob, row.job_id)
        if not job:
            continue
        if job.status == OutboundStatus.sent:
            row.status = "sent"
            row.updated_at = datetime.utcnow()
            db.add(row)
            changed = True
        elif job.status == OutboundStatus.failed:
            row.status = "failed"
            row.error = (job.error or "")[:2000]
            row.updated_at = datetime.utcnow()
            db.add(row)
            changed = True
    return changed


def reconcile_campaign(db: Session, campaign_id: str) -> bool:
    """Sync job results and flip campaign to done when nothing is left open."""
    changed = sync_campaign_sends_from_jobs(db, campaign_id)
    finished = _maybe_finish_campaign(db, campaign_id)
    return changed or finished


def _maybe_finish_campaign(db: Session, campaign_id: str) -> bool:
    open_n = (
        db.query(CampaignSend)
        .filter(
            CampaignSend.campaign_id == campaign_id,
            CampaignSend.status.in_(("pending", "queued")),
        )
        .count()
    )
    if open_n > 0:
        return False
    camp = db.get(Campaign, campaign_id)
    if not camp:
        return False
    # Also finish if somehow still "running" with zero send rows
    has_rows = (
        db.query(CampaignSend).filter(CampaignSend.campaign_id == campaign_id).count()
    )
    if has_rows == 0 and camp.status in ("running", "queued"):
        # started but audience cleared oddly — leave running unless finished_at set elsewhere
        return False
    if camp.status in ("running", "queued") and has_rows > 0:
        camp.status = "done"
        camp.finished_at = datetime.utcnow()
        camp.updated_at = datetime.utcnow()
        db.add(camp)
        return True
    return False


def org_has_active_campaign(
    db: Session, org_id: str, *, exclude_id: str | None = None
) -> Campaign | None:
    """Return another running/queued campaign for this org, if any."""
    q = db.query(Campaign).filter(
        Campaign.org_id == org_id,
        Campaign.status.in_(("running", "queued")),
    )
    if exclude_id:
        q = q.filter(Campaign.id != exclude_id)
    return q.order_by(Campaign.started_at.desc()).first()
