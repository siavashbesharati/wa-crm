"""WhatsApp LID ↔ phone (PN) identity helpers and lead merge."""

from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import AiEvent, CampaignSend, Lead, LeadAccountLink, Message, OutboundJob, Task

_PHONE_RE = re.compile(r"^\+?\d{8,15}$")


def normalize_lid(value: str | None) -> str:
    s = (value or "").strip()
    if not s:
        return ""
    if s.endswith("@lid"):
        local = s.split("@")[0].split(":")[0]
        return f"{local}@lid" if local else ""
    # Bare LID digits sometimes arrive without server
    if re.fullmatch(r"\d{8,20}", s):
        return f"{s}@lid"
    return ""


def is_lid_jid(value: str | None) -> bool:
    return (value or "").strip().endswith("@lid")


def is_pn_jid(value: str | None) -> bool:
    s = (value or "").strip()
    return s.endswith("@s.whatsapp.net") or s.endswith("@c.us")


def looks_like_phone(value: str | None) -> bool:
    t = re.sub(r"[\s\-()]", "", str(value or ""))
    return bool(_PHONE_RE.match(t))


def is_opaque_wa_name(value: str | None) -> bool:
    s = (value or "").strip()
    if not s:
        return True
    if is_lid_jid(s) or is_pn_jid(s) or s.endswith("@g.us"):
        return True
    if looks_like_phone(s):
        return True
    return False


def prefer_pn_external(phone: str | None, external_chat_id: str | None, wa_lid: str | None) -> str | None:
    """Stable CRM chat id: PN jid > existing PN > LID."""
    ph = (phone or "").strip()
    if looks_like_phone(ph):
        digits = re.sub(r"\D", "", ph)
        return f"{digits}@s.whatsapp.net"
    ext = (external_chat_id or "").strip()
    if is_pn_jid(ext):
        local = ext.split("@")[0].split(":")[0]
        return f"{local}@s.whatsapp.net" if local else ext
    lid = normalize_lid(wa_lid) or (normalize_lid(ext) if is_lid_jid(ext) else "")
    return lid or (ext or None)


def _identity_score(db: Session, lead: Lead) -> int:
    score = 0
    if looks_like_phone(lead.phone or ""):
        score += 100
    ext = (lead.external_chat_id or "").strip()
    if is_pn_jid(ext):
        score += 50
    elif is_lid_jid(ext):
        score += 5
    if not is_opaque_wa_name(lead.name):
        score += 30
    msg_n = (
        db.query(Message)
        .filter(Message.org_id == lead.org_id, Message.lead_id == lead.id)
        .count()
    )
    score += min(int(msg_n), 25)
    # Prefer older lead as stable identity (created earlier → slightly higher)
    if lead.created_at:
        score += 1
    return score


def pick_winner(db: Session, leads: list[Lead]) -> Lead:
    ranked = sorted(
        leads,
        key=lambda l: (_identity_score(db, l), l.created_at or datetime.min),
        reverse=True,
    )
    return ranked[0]


def merge_lead_into(db: Session, *, winner: Lead, loser: Lead) -> Lead:
    """Move all FK rows from loser → winner, copy better fields, delete loser."""
    if winner.id == loser.id:
        return winner
    if winner.org_id != loser.org_id:
        raise ValueError("cross-org merge refused")

    org_id = winner.org_id

    db.query(Message).filter(Message.org_id == org_id, Message.lead_id == loser.id).update(
        {Message.lead_id: winner.id}, synchronize_session=False
    )
    db.query(OutboundJob).filter(
        OutboundJob.org_id == org_id, OutboundJob.lead_id == loser.id
    ).update({OutboundJob.lead_id: winner.id}, synchronize_session=False)
    db.query(Task).filter(Task.org_id == org_id, Task.lead_id == loser.id).update(
        {Task.lead_id: winner.id}, synchronize_session=False
    )
    db.query(AiEvent).filter(AiEvent.org_id == org_id, AiEvent.lead_id == loser.id).update(
        {AiEvent.lead_id: winner.id}, synchronize_session=False
    )

    # Campaign sends: unique(campaign_id, lead_id) — drop loser rows that clash
    loser_sends = (
        db.query(CampaignSend).filter(CampaignSend.lead_id == loser.id).all()
    )
    for row in loser_sends:
        clash = (
            db.query(CampaignSend)
            .filter(
                CampaignSend.campaign_id == row.campaign_id,
                CampaignSend.lead_id == winner.id,
            )
            .first()
        )
        if clash:
            db.delete(row)
        else:
            row.lead_id = winner.id
            db.add(row)

    loser_links = (
        db.query(LeadAccountLink)
        .filter(LeadAccountLink.org_id == org_id, LeadAccountLink.lead_id == loser.id)
        .all()
    )
    for link in loser_links:
        existing = (
            db.query(LeadAccountLink)
            .filter(
                LeadAccountLink.org_id == org_id,
                LeadAccountLink.lead_id == winner.id,
                LeadAccountLink.account_id == link.account_id,
            )
            .first()
        )
        if existing:
            # Prefer PN external id on the surviving link
            win_ext = (existing.external_chat_id or "").strip()
            lose_ext = (link.external_chat_id or "").strip()
            if (not win_ext or is_lid_jid(win_ext)) and lose_ext and not is_lid_jid(lose_ext):
                taken = (
                    db.query(LeadAccountLink)
                    .filter(
                        LeadAccountLink.org_id == org_id,
                        LeadAccountLink.account_id == link.account_id,
                        LeadAccountLink.external_chat_id == lose_ext,
                        LeadAccountLink.id != existing.id,
                    )
                    .first()
                )
                if not taken:
                    existing.external_chat_id = lose_ext
            if is_opaque_wa_name(existing.chat_name) and link.chat_name and not is_opaque_wa_name(
                link.chat_name
            ):
                name_taken = (
                    db.query(LeadAccountLink)
                    .filter(
                        LeadAccountLink.org_id == org_id,
                        LeadAccountLink.account_id == link.account_id,
                        LeadAccountLink.chat_name == link.chat_name,
                        LeadAccountLink.id != existing.id,
                    )
                    .first()
                )
                if not name_taken:
                    existing.chat_name = link.chat_name
            db.add(existing)
            db.delete(link)
        else:
            # Re-point; resolve unique clashes on ext/chat_name
            ext = (link.external_chat_id or "").strip() or None
            if ext:
                clash = (
                    db.query(LeadAccountLink)
                    .filter(
                        LeadAccountLink.org_id == org_id,
                        LeadAccountLink.account_id == link.account_id,
                        LeadAccountLink.external_chat_id == ext,
                        LeadAccountLink.id != link.id,
                    )
                    .first()
                )
                if clash:
                    link.external_chat_id = None
            name = (link.chat_name or "").strip()
            if name:
                clash_n = (
                    db.query(LeadAccountLink)
                    .filter(
                        LeadAccountLink.org_id == org_id,
                        LeadAccountLink.account_id == link.account_id,
                        LeadAccountLink.chat_name == name,
                        LeadAccountLink.id != link.id,
                    )
                    .first()
                )
                if clash_n:
                    link.chat_name = f"{name}·{winner.id[:8]}"
            link.lead_id = winner.id
            db.add(link)

    # Field merge
    if looks_like_phone(loser.phone or "") and not looks_like_phone(winner.phone or ""):
        winner.phone = loser.phone
    if is_opaque_wa_name(winner.name) and not is_opaque_wa_name(loser.name):
        winner.name = loser.name
    lose_ext = (loser.external_chat_id or "").strip()
    win_ext = (winner.external_chat_id or "").strip()
    if (not win_ext or is_lid_jid(win_ext)) and lose_ext and not is_lid_jid(lose_ext):
        winner.external_chat_id = lose_ext
    lose_lid = normalize_lid(getattr(loser, "wa_lid", None) or "") or (
        normalize_lid(lose_ext) if is_lid_jid(lose_ext) else ""
    )
    win_lid = normalize_lid(getattr(winner, "wa_lid", None) or "")
    if lose_lid and not win_lid:
        winner.wa_lid = lose_lid
    if not winner.source_channel and loser.source_channel:
        winner.source_channel = loser.source_channel
    if loser.notes and not winner.notes:
        winner.notes = loser.notes
    # tags union
    wtags = list(winner.tags or [])
    for t in loser.tags or []:
        if t not in wtags:
            wtags.append(t)
    winner.tags = wtags
    if (loser.lead_score or 0) > (winner.lead_score or 0):
        winner.lead_score = loser.lead_score
    if not winner.assignee_id and loser.assignee_id:
        winner.assignee_id = loser.assignee_id
    # Keep bot running if either side was running? Prefer paused if either paused (safer)
    if loser.bot_paused:
        winner.bot_paused = True
    if loser.last_message_at and (
        not winner.last_message_at or loser.last_message_at > winner.last_message_at
    ):
        winner.last_message_at = loser.last_message_at
    winner.updated_at = datetime.utcnow()
    db.add(winner)
    db.delete(loser)
    db.flush()
    return winner


def find_wa_identity_candidates(
    db: Session,
    *,
    org_id: str,
    external_chat_id: str | None,
    phone: str | None,
    wa_lid: str | None,
) -> list[Lead]:
    """Find PV leads that share PN / LID identity."""
    found: dict[str, Lead] = {}

    def _add(lead: Lead | None) -> None:
        if not lead:
            return
        # Skip groups
        ct = (lead.chat_type or "").strip().lower()
        if ct == "group":
            return
        gid = (lead.group_id or "").strip()
        ext = (lead.external_chat_id or "").strip()
        if gid.endswith("@g.us") or ext.endswith("@g.us") or ext.startswith("gname:"):
            return
        found[lead.id] = lead

    ext = (external_chat_id or "").strip() or None
    lid = normalize_lid(wa_lid) or (normalize_lid(ext) if is_lid_jid(ext) else "")
    ph = (phone or "").strip() or None
    if ph:
        ph = re.sub(r"\D", "", ph) or ph

    if ext:
        _add(
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.external_chat_id == ext)
            .first()
        )
        # Old LID-only leads may have LID only as name / phone incorrectly skipped
        _add(
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.wa_lid == ext)
            .first()
        )

    if lid:
        _add(
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.wa_lid == lid)
            .first()
        )
        _add(
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.external_chat_id == lid)
            .first()
        )

    if ph and looks_like_phone(ph):
        _add(db.query(Lead).filter(Lead.org_id == org_id, Lead.phone == ph).first())
        pn = f"{ph}@s.whatsapp.net"
        _add(
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.external_chat_id == pn)
            .first()
        )
        # Also match phone stored with +
        _add(
            db.query(Lead)
            .filter(Lead.org_id == org_id, Lead.phone == f"+{ph}")
            .first()
        )

    return list(found.values())


def apply_wa_identity(
    lead: Lead,
    *,
    phone: str | None,
    external_chat_id: str | None,
    wa_lid: str | None,
    chat_name: str | None = None,
) -> None:
    """Upgrade lead fields toward PN + store LID."""
    lid = normalize_lid(wa_lid) or (
        normalize_lid(external_chat_id) if is_lid_jid(external_chat_id) else ""
    )
    if lid:
        lead.wa_lid = lid
    preferred = prefer_pn_external(phone, external_chat_id, lid or None)
    if preferred:
        cur = (lead.external_chat_id or "").strip()
        if not cur or is_lid_jid(cur) or (is_pn_jid(preferred) and not is_pn_jid(cur)):
            lead.external_chat_id = preferred
    if phone and looks_like_phone(phone):
        digits = re.sub(r"\D", "", phone)
        if not looks_like_phone(lead.phone or ""):
            lead.phone = digits
    # Heal opaque @lid display names
    if chat_name and not is_opaque_wa_name(chat_name) and is_opaque_wa_name(lead.name):
        lead.name = chat_name[:200]


def merge_org_wa_duplicates(db: Session, org_id: str) -> int:
    """
    One-shot: merge PV leads that share phone or LID identity.
    Returns number of leads deleted (merged away).
    """
    leads = (
        db.query(Lead)
        .filter(Lead.org_id == org_id)
        .all()
    )
    pv = []
    for l in leads:
        ct = (l.chat_type or "").strip().lower()
        if ct == "group":
            continue
        ext = (l.external_chat_id or "").strip()
        if ext.endswith("@g.us") or ext.startswith("gname:"):
            continue
        pv.append(l)

    merged_away = 0
    # Index by phone / lid
    by_phone: dict[str, list[Lead]] = {}
    by_lid: dict[str, list[Lead]] = {}
    for l in pv:
        ph = re.sub(r"\D", "", l.phone or "")
        if looks_like_phone(ph):
            by_phone.setdefault(ph, []).append(l)
        lid = normalize_lid(getattr(l, "wa_lid", None) or "") or (
            normalize_lid(l.external_chat_id) if is_lid_jid(l.external_chat_id) else ""
        )
        if lid:
            by_lid.setdefault(lid, []).append(l)
        # PN local part as phone key
        if is_pn_jid(l.external_chat_id):
            local = (l.external_chat_id or "").split("@")[0].split(":")[0]
            if looks_like_phone(local):
                by_phone.setdefault(local, []).append(l)

    seen: set[str] = set()

    def _collapse(group: list[Lead]) -> None:
        nonlocal merged_away
        uniq: dict[str, Lead] = {}
        for g in group:
            uniq[g.id] = g
        ids = [i for i in uniq if i not in seen]
        if len(ids) < 2:
            return
        members = [uniq[i] for i in ids]
        winner = pick_winner(db, members)
        for m in members:
            if m.id == winner.id:
                continue
            if m.id in seen:
                continue
            merge_lead_into(db, winner=winner, loser=m)
            seen.add(m.id)
            merged_away += 1
        seen.add(winner.id)

    for group in by_phone.values():
        _collapse(group)
    for group in by_lid.values():
        _collapse(group)

    return merged_away
