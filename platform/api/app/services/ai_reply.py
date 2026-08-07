"""Build AI replies: knowledge retrieve + Gemini generation."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AiPolicy, KnowledgeChunk, Lead, PlatformSetting
from app.services import gemini
from app.services.embeddings import cosine, embed_text

AI_DEFAULTS_KEY = "ai_defaults"

DEFAULT_PLATFORM_SYSTEM = (
    "تو دستیار فروش و پشتیبانی یک کسب‌وکار ایرانی هستی. "
    "فقط بر اساس دانش سازمانی و نقش تعریف‌شده پاسخ بده. "
    "اگر اطلاعات کافی نداری صادقانه بگو و پیشنهاد تماس با پشتیبانی بده. "
    "پاسخ را کوتاه، مودب و به فارسی بنویس."
)


def get_platform_ai_settings(db: Session) -> dict:
    settings = get_settings()
    base = {
        "gemini_api_key": getattr(settings, "gemini_api_key", "") or "",
        "gemini_model": getattr(settings, "gemini_model", "") or gemini.DEFAULT_MODEL,
        "system_prompt": DEFAULT_PLATFORM_SYSTEM,
        "default_min_confidence": 0.55,
        "auto_send_default": False,
        "notes": "",
        "openai_model": "",
        "openai_base_url": "",
    }
    row = db.get(PlatformSetting, AI_DEFAULTS_KEY)
    if row and isinstance(row.value, dict):
        # Only override with non-empty stored values for the API key
        for k, v in row.value.items():
            if v is None:
                continue
            if k == "gemini_api_key" and not str(v).strip():
                continue
            base[k] = v
    if not (base.get("gemini_model") or "").strip():
        base["gemini_model"] = gemini.DEFAULT_MODEL
    if not (base.get("system_prompt") or "").strip():
        base["system_prompt"] = DEFAULT_PLATFORM_SYSTEM
    return base


def retrieve_knowledge(
    db: Session, org_id: str, query: str, k: int = 4
) -> list[tuple[KnowledgeChunk, float]]:
    qv = embed_text(query)
    chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.org_id == org_id).all()
    scored = [(c, cosine(qv, c.embedding or [])) for c in chunks]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]


def _compose_system_prompt(platform: dict, policy: AiPolicy | None) -> str:
    parts: list[str] = []
    plat = (platform.get("system_prompt") or "").strip()
    if plat:
        parts.append(plat)
    if policy:
        role = (getattr(policy, "agent_role", None) or "").strip()
        org_sys = (getattr(policy, "system_prompt", None) or "").strip()
        if role:
            parts.append(f"نقش تو در این کسب‌وکار: {role}")
        if org_sys:
            parts.append(org_sys)
    return "\n\n".join(parts) or DEFAULT_PLATFORM_SYSTEM


def _compose_user_prompt(
    *,
    lead: Lead | None,
    message: str,
    hits: list[tuple[KnowledgeChunk, float]],
) -> str:
    kb_blocks = []
    for i, (chunk, score) in enumerate(hits, start=1):
        if score < 0.02:
            continue
        kb_blocks.append(f"[{i}] (امتیاز {score:.2f})\n{chunk.content[:800]}")
    kb_text = "\n\n".join(kb_blocks) if kb_blocks else "(دانش مرتبطی یافت نشد)"
    lead_name = (lead.name if lead else "") or "مشتری"
    lead_stage = (lead.stage if lead else "") or "-"
    return (
        f"نام لید: {lead_name}\n"
        f"مرحله قیف: {lead_stage}\n\n"
        f"دانش سازمانی مرتبط:\n{kb_text}\n\n"
        f"پیام مشتری:\n{message.strip()}\n\n"
        "یک پاسخ مناسب برای ارسال به مشتری بنویس. فقط متن پاسخ را برگردان."
    )


def generate_reply(
    db: Session,
    *,
    org_id: str,
    lead: Lead | None,
    message: str,
) -> dict:
    """Return {reply, confidence, sources, provider}."""
    platform = get_platform_ai_settings(db)
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
    hits = retrieve_knowledge(db, org_id, message, k=4)
    top_score = float(hits[0][1]) if hits else 0.0
    sources = [h[0].content[:120] for h in hits if h[1] > 0.05]

    api_key = (platform.get("gemini_api_key") or "").strip()
    if not api_key:
        # Fallback without LLM: paste top chunk (legacy behavior)
        if not hits or top_score < 0.05:
            return {
                "reply": "سلام، پیام شما دریافت شد. همکاران ما به‌زودی پاسخ می‌دهند.",
                "confidence": 0.2,
                "sources": [],
                "provider": "fallback",
            }
        name = (lead.name if lead else "") or ""
        reply = f"سلام {name}".strip() + "،\n" + hits[0][0].content[:500]
        return {
            "reply": reply,
            "confidence": round(top_score, 3),
            "sources": sources,
            "provider": "knowledge_only",
        }

    system_prompt = _compose_system_prompt(platform, policy)
    user_prompt = _compose_user_prompt(lead=lead, message=message, hits=hits)
    reply = gemini.generate_text(
        api_key=api_key,
        model=str(platform.get("gemini_model") or gemini.DEFAULT_MODEL),
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    # Confidence: blend retrieval score with successful generation
    confidence = round(max(0.45, min(0.98, 0.35 + top_score * 0.65)), 3)
    if not sources:
        confidence = min(confidence, 0.55)
    return {
        "reply": reply,
        "confidence": confidence,
        "sources": sources,
        "provider": "gemini",
    }
