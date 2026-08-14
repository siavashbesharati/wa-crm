"""Lightweight AI event log for KPIs and suggest funnel metrics."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AiEvent


def record_ai_event(
    db: Session,
    *,
    org_id: str,
    event_type: str,
    lead_id: str | None = None,
    payload: dict[str, Any] | None = None,
    commit: bool = False,
) -> AiEvent:
    row = AiEvent(
        org_id=org_id,
        event_type=(event_type or "").strip()[:80] or "unknown",
        lead_id=lead_id,
        payload=payload or {},
    )
    db.add(row)
    if commit:
        db.commit()
        db.refresh(row)
    return row
