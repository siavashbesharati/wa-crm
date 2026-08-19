from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth, require_roles
from app.models import AutomationRule, MemberRole
from app.schemas import AutomationRuleIn, AutomationRuleOut

router = APIRouter(prefix="/automations", tags=["automations"])


def _out(rule: AutomationRule) -> AutomationRuleOut:
    return AutomationRuleOut(
        id=rule.id,
        name=rule.name,
        enabled=rule.enabled,
        priority=rule.priority,
        trigger_type=rule.trigger_type,
        source_channel=rule.source_channel,
        source_account_id=rule.source_account_id,
        conditions=rule.conditions or [],
        actions=rule.actions or [],
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


@router.get("", response_model=list[AutomationRuleOut])
def list_rules(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    rows = (
        db.query(AutomationRule)
        .filter(AutomationRule.org_id == auth.org.id)
        .order_by(AutomationRule.priority.asc(), AutomationRule.created_at.asc())
        .all()
    )
    return [_out(row) for row in rows]


@router.post("", response_model=AutomationRuleOut)
def create_rule(
    body: AutomationRuleIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    if body.source_channel != "instagram":
        raise HTTPException(status_code=400, detail="فعلاً فقط قوانین اینستاگرام پشتیبانی می‌شوند")
    if body.source_account_id:
        from app.models import ChannelAccount, ChannelType

        account = (
            db.query(ChannelAccount)
            .filter(
                ChannelAccount.id == body.source_account_id,
                ChannelAccount.org_id == auth.org.id,
                ChannelAccount.channel == ChannelType.instagram,
            )
            .first()
        )
        if not account:
            raise HTTPException(status_code=404, detail="اکانت اینستاگرام یافت نشد")
    rule = AutomationRule(
        org_id=auth.org.id,
        name=body.name.strip(),
        enabled=body.enabled,
        priority=body.priority,
        trigger_type=body.trigger_type,
        source_channel=body.source_channel,
        source_account_id=body.source_account_id,
        conditions=body.conditions,
        actions=body.actions,
        created_by_id=auth.user.id,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _out(rule)


@router.patch("/{rule_id}", response_model=AutomationRuleOut)
def update_rule(
    rule_id: str,
    body: AutomationRuleIn,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin, MemberRole.agent)),
    db: Session = Depends(get_db),
):
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id, AutomationRule.org_id == auth.org.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="قانون یافت نشد")
    for field in ("name", "enabled", "priority", "trigger_type", "source_channel", "source_account_id", "conditions", "actions"):
        setattr(rule, field, getattr(body, field))
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _out(rule)


@router.delete("/{rule_id}")
def delete_rule(
    rule_id: str,
    auth: AuthContext = Depends(require_roles(MemberRole.owner, MemberRole.admin)),
    db: Session = Depends(get_db),
):
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id, AutomationRule.org_id == auth.org.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="قانون یافت نشد")
    db.delete(rule)
    db.commit()
    return {"ok": True}
