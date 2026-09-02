"""Structured coach tools for آقای میوژن — SQL tool router (not WhatsApp send).

Used when phrase matching + analytics already ran, or as a second-pass for
free-form questions that map cleanly to known tools.
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from app.services import org_analytics as oa


TOOL_SPECS: list[dict[str, str]] = [
    {
        "name": "query_hot_leads",
        "intent": oa.INTENT_HOT_TODAY,
        "desc": "Rank hottest open-funnel leads",
    },
    {
        "name": "query_task_stats",
        "intent": oa.INTENT_TASKS_COMPLETED,
        "desc": "Rank staff by completed tasks",
    },
    {
        "name": "query_lead_playbook",
        "intent": oa.INTENT_LEAD_PLAYBOOK,
        "desc": "Hot leads with conversation-based next actions",
    },
    {
        "name": "query_top_sellers",
        "intent": oa.INTENT_TOP_SELLER,
        "desc": "Top sellers by closed deals",
    },
    {
        "name": "query_top_operators",
        "intent": oa.INTENT_TOP_OPERATOR,
        "desc": "Most efficient operators",
    },
    {
        "name": "query_risk_leads",
        "intent": oa.INTENT_RISK,
        "desc": "Leads at churn / escalation risk",
    },
    {
        "name": "query_open_leads",
        "intent": oa.INTENT_OPEN_LEADS,
        "desc": "Open funnel leads list",
    },
    {
        "name": "search_conversations",
        "intent": "",
        "desc": "Semantic CRM conversation search (handled by retrieve_crm_context)",
    },
]


def _pick_tools_llm(db: Session, message: str) -> tuple[list[str], int]:
    """Ask LLM which tools to run. Returns (intent keys, limit)."""
    try:
        from app.services.ai_reply import generate_llm_text, get_platform_ai_settings

        catalog = "\n".join(f"- {t['name']}: {t['desc']}" for t in TOOL_SPECS)
        system = (
            "Pick up to 2 tools for a CRM coach question. "
            'Reply ONLY JSON: {"tools":["query_hot_leads"],"limit":10}. '
            f"Available tools:\n{catalog}"
        )
        platform = get_platform_ai_settings(db)
        result = generate_llm_text(
            platform,
            system_prompt=system,
            user_prompt=(message or "")[:500],
            temperature=0.0,
        )
        raw = (result.get("reply") or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
        data = json.loads(raw)
        names = [str(x).strip() for x in (data.get("tools") or [])]
        name_to_intent = {t["name"]: t["intent"] for t in TOOL_SPECS if t["intent"]}
        intents = [name_to_intent[n] for n in names if n in name_to_intent][:2]
        limit = max(1, min(int(data.get("limit") or oa.TOP_N), 20))
        return intents, limit
    except Exception:  # noqa: BLE001
        return [], oa.TOP_N


def maybe_run_coach_tools(
    db: Session,
    org_id: str,
    message: str,
    *,
    already_has_analytics: bool = False,
) -> str:
    """Run structured tools when analytics is empty but the question looks CRM-related."""
    if already_has_analytics or not org_id:
        return ""
    if not oa.looks_analytical(message):
        return ""
    intents, limit = _pick_tools_llm(db, message)
    # Drop search_conversations — handled by CRM RAG in coach turn
    intents = [i for i in intents if i in oa.ANALYTICS_KINDS][:2]
    if not intents:
        return ""
    results = oa.run_analytics(db, org_id, intents, limit=limit)
    report = oa.format_analytics_report(results)
    if not report:
        return ""
    return "### ابزارهای ساخت‌یافته مربی\n" + report.replace("### گزارش تحلیلی (SQL)\n", "")


def run_tool(
    db: Session, org_id: str, tool_name: str, *, limit: int = 10
) -> dict[str, Any]:
    """Direct tool invoke for API/debug."""
    name_to_intent = {t["name"]: t["intent"] for t in TOOL_SPECS}
    intent = name_to_intent.get(tool_name or "")
    if not intent:
        return {"ok": False, "error": "unknown_tool"}
    rows = oa.run_analytics(db, org_id, [intent], limit=limit).get(intent) or []
    return {"ok": True, "tool": tool_name, "intent": intent, "rows": rows}
