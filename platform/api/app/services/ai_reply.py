"""Build AI replies: knowledge retrieve + configurable LLM (OpenAI-compatible or Gemini)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AiPolicy, KnowledgeChunk, Lead, PlatformSetting
from app.services import gemini, openai_compat
from app.services.embeddings import cosine, embed_text

AI_DEFAULTS_KEY = "ai_defaults"

DEFAULT_PLATFORM_SYSTEM = (
    "تو دستیار فروش و پشتیبانی یک کسب‌وکار ایرانی هستی. "
    "فقط بر اساس دانش سازمانی و نقش تعریف‌شده پاسخ بده. "
    "اگر اطلاعات کافی نداری صادقانه بگو و پیشنهاد تماس با پشتیبانی بده. "
    "پاسخ را کوتاه، مودب و به فارسی بنویس."
)

PROVIDERS = ("openai_compatible", "gemini")


def get_platform_ai_settings(db: Session) -> dict:
    settings = get_settings()
    base = {
        "provider": "openai_compatible",
        "api_key": getattr(settings, "openai_api_key", "") or "",
        "base_url": getattr(settings, "openai_base_url", "") or openai_compat.DEFAULT_BASE_URL,
        "model": getattr(settings, "openai_model", "") or openai_compat.DEFAULT_MODEL,
        "temperature": 0.4,
        "max_tokens": 2048,
        "top_p": 1.0,
        "reasoning_effort": "",
        "system_prompt": DEFAULT_PLATFORM_SYSTEM,
        "default_min_confidence": 0.55,
        "auto_send_default": False,
        "notes": "",
        # legacy Gemini fields
        "gemini_api_key": getattr(settings, "gemini_api_key", "") or "",
        "gemini_model": getattr(settings, "gemini_model", "") or gemini.DEFAULT_MODEL,
        "openai_model": getattr(settings, "openai_model", "") or "",
        "openai_base_url": getattr(settings, "openai_base_url", "") or "",
    }
    row = db.get(PlatformSetting, AI_DEFAULTS_KEY)
    if row and isinstance(row.value, dict):
        for k, v in row.value.items():
            if v is None:
                continue
            # Never wipe stored secrets with empty strings from partial merges
            if k in ("api_key", "gemini_api_key", "openai_api_key") and not str(v).strip():
                continue
            base[k] = v

    # Migrate legacy openai_* into unified fields if empty
    if not (base.get("api_key") or "").strip():
        legacy = (base.get("openai_api_key") or getattr(settings, "openai_api_key", "") or "").strip()
        if legacy:
            base["api_key"] = legacy
    if not (base.get("base_url") or "").strip():
        base["base_url"] = (
            (base.get("openai_base_url") or "").strip()
            or getattr(settings, "openai_base_url", "")
            or openai_compat.DEFAULT_BASE_URL
        )
    if not (base.get("model") or "").strip():
        base["model"] = (
            (base.get("openai_model") or "").strip()
            or getattr(settings, "openai_model", "")
            or openai_compat.DEFAULT_MODEL
        )

    provider = (base.get("provider") or "").strip().lower()
    if provider not in PROVIDERS:
        # Auto-detect from what is configured
        if (base.get("api_key") or "").strip() or (
            (base.get("base_url") or "").strip()
            and "generativelanguage" not in (base.get("base_url") or "")
        ):
            # Prefer openai_compatible when api_key / custom base present
            if (base.get("api_key") or "").strip():
                provider = "openai_compatible"
            elif (base.get("gemini_api_key") or "").strip():
                provider = "gemini"
            else:
                provider = "openai_compatible"
        elif (base.get("gemini_api_key") or "").strip():
            provider = "gemini"
        else:
            provider = "openai_compatible"
    base["provider"] = provider

    if not (base.get("gemini_model") or "").strip():
        base["gemini_model"] = gemini.DEFAULT_MODEL
    if not (base.get("system_prompt") or "").strip():
        base["system_prompt"] = DEFAULT_PLATFORM_SYSTEM

    try:
        base["temperature"] = float(base.get("temperature") if base.get("temperature") is not None else 0.4)
    except (TypeError, ValueError):
        base["temperature"] = 0.4
    try:
        base["max_tokens"] = int(base.get("max_tokens") or 2048)
    except (TypeError, ValueError):
        base["max_tokens"] = 2048
    try:
        base["top_p"] = float(base.get("top_p") if base.get("top_p") is not None else 1.0)
    except (TypeError, ValueError):
        base["top_p"] = 1.0

    return base


def llm_is_configured(platform: dict) -> bool:
    provider = (platform.get("provider") or "openai_compatible").strip().lower()
    if provider == "gemini":
        return bool((platform.get("gemini_api_key") or "").strip())
    return bool((platform.get("api_key") or "").strip())


def resolve_model(platform: dict) -> str:
    provider = (platform.get("provider") or "openai_compatible").strip().lower()
    if provider == "gemini":
        return str(platform.get("gemini_model") or gemini.DEFAULT_MODEL)
    return str(platform.get("model") or openai_compat.DEFAULT_MODEL)


def generate_llm_text(
    platform: dict,
    *,
    system_prompt: str,
    user_prompt: str,
    temperature: float | None = None,
) -> dict:
    """Call configured provider. Returns {reply, provider, model}."""
    provider = (platform.get("provider") or "openai_compatible").strip().lower()
    temp = float(temperature if temperature is not None else platform.get("temperature") or 0.4)

    if provider == "gemini":
        api_key = (platform.get("gemini_api_key") or "").strip()
        model = str(platform.get("gemini_model") or gemini.DEFAULT_MODEL)
        if not api_key:
            raise ValueError("کلید Gemini پیکربندی نشده")
        reply = gemini.generate_text(
            api_key=api_key,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temp,
            max_output_tokens=int(platform.get("max_tokens") or 2048),
        )
        return {"reply": reply, "provider": "gemini", "model": model}

    api_key = (platform.get("api_key") or "").strip()
    model = str(platform.get("model") or openai_compat.DEFAULT_MODEL)
    base_url = str(platform.get("base_url") or openai_compat.DEFAULT_BASE_URL)
    if not api_key:
        raise ValueError("کلید API پیکربندی نشده — Base URL و کلید را در تنظیمات AI ذخیره کنید")
    reply = openai_compat.chat_completion(
        api_key=api_key,
        base_url=base_url,
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temp,
        max_tokens=int(platform.get("max_tokens") or 2048),
        top_p=float(platform.get("top_p") if platform.get("top_p") is not None else 1.0),
        reasoning_effort=(platform.get("reasoning_effort") or "").strip() or None,
    )
    # Label for UI: guess from base_url
    label = "openai_compatible"
    bu = base_url.lower()
    if "groq.com" in bu:
        label = "groq"
    elif "x.ai" in bu:
        label = "xai"
    elif "openai.com" in bu:
        label = "openai"
    return {"reply": reply, "provider": label, "model": model}


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
    """Return {reply, confidence, sources, provider, model}."""
    platform = get_platform_ai_settings(db)
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
    hits = retrieve_knowledge(db, org_id, message, k=4)
    top_score = float(hits[0][1]) if hits else 0.0
    sources = [h[0].content[:120] for h in hits if h[1] > 0.05]

    if not llm_is_configured(platform):
        if not hits or top_score < 0.05:
            return {
                "reply": "سلام، پیام شما دریافت شد. همکاران ما به‌زودی پاسخ می‌دهند.",
                "confidence": 0.2,
                "sources": [],
                "provider": "fallback",
                "model": "",
            }
        name = (lead.name if lead else "") or ""
        reply = f"سلام {name}".strip() + "،\n" + hits[0][0].content[:500]
        return {
            "reply": reply,
            "confidence": round(top_score, 3),
            "sources": sources,
            "provider": "knowledge_only",
            "model": "",
        }

    system_prompt = _compose_system_prompt(platform, policy)
    user_prompt = _compose_user_prompt(lead=lead, message=message, hits=hits)
    out = generate_llm_text(platform, system_prompt=system_prompt, user_prompt=user_prompt)
    confidence = round(max(0.45, min(0.98, 0.35 + top_score * 0.65)), 3)
    if not sources:
        confidence = min(confidence, 0.55)
    return {
        "reply": out["reply"],
        "confidence": confidence,
        "sources": sources,
        "provider": out["provider"],
        "model": out.get("model") or "",
    }


def playground_reply(
    db: Session,
    *,
    message: str,
    org_id: str | None = None,
    lead_name: str = "مشتری تست",
    lead_stage: str = "جدید",
    system_prompt_override: str | None = None,
    agent_role_override: str | None = None,
    temperature: float = 0.4,
) -> dict:
    """Super-admin playground: uses platform LLM config (+ optional org knowledge)."""
    platform = get_platform_ai_settings(db)
    if not llm_is_configured(platform):
        raise ValueError("سرویس AI پیکربندی نشده — کلید و Base URL را در تنظیمات AI ذخیره کنید")

    policy: AiPolicy | None = None
    hits: list[tuple[KnowledgeChunk, float]] = []
    if org_id:
        policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
        hits = retrieve_knowledge(db, org_id, message, k=4)

    if system_prompt_override is not None and system_prompt_override.strip():
        parts = [system_prompt_override.strip()]
    else:
        parts = []
        plat = (platform.get("system_prompt") or "").strip()
        if plat:
            parts.append(plat)

    role = (agent_role_override or "").strip()
    if not role and policy:
        role = (getattr(policy, "agent_role", None) or "").strip()
    if role:
        parts.append(f"نقش تو در این کسب‌وکار: {role}")

    if policy and not (system_prompt_override or "").strip():
        org_sys = (getattr(policy, "system_prompt", None) or "").strip()
        if org_sys:
            parts.append(org_sys)

    system_prompt = "\n\n".join(parts) or DEFAULT_PLATFORM_SYSTEM

    kb_blocks = []
    for i, (chunk, score) in enumerate(hits, start=1):
        if score < 0.02:
            continue
        kb_blocks.append(f"[{i}] (امتیاز {score:.2f})\n{chunk.content[:800]}")
    if org_id:
        kb_text = "\n\n".join(kb_blocks) if kb_blocks else "(دانش مرتبطی یافت نشد)"
    else:
        kb_text = "(بدون سازمان — فقط پرامپت پلتفرم)"

    user_prompt = (
        f"نام لید: {(lead_name or 'مشتری تست').strip()}\n"
        f"مرحله قیف: {(lead_stage or 'جدید').strip()}\n\n"
        f"دانش سازمانی مرتبط:\n{kb_text}\n\n"
        f"پیام مشتری:\n{message.strip()}\n\n"
        "یک پاسخ مناسب برای ارسال به مشتری بنویس. فقط متن پاسخ را برگردان."
    )

    out = generate_llm_text(
        platform,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=float(temperature),
    )
    top_score = float(hits[0][1]) if hits else 0.0
    sources = [h[0].content[:160] for h in hits if h[1] > 0.05]
    confidence = round(max(0.45, min(0.98, 0.35 + top_score * 0.65)), 3) if hits else 0.5
    if hits and not sources:
        confidence = min(confidence, 0.55)

    return {
        "reply": out["reply"],
        "confidence": confidence,
        "sources": sources,
        "provider": out["provider"],
        "model": out.get("model") or resolve_model(platform),
        "system_prompt_used": system_prompt,
        "knowledge_hits": len(sources),
        "org_id": org_id or "",
        "base_url": (platform.get("base_url") or "") if platform.get("provider") != "gemini" else "",
    }
