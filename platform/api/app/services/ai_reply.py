"""Build AI replies: knowledge retrieve + configurable LLM (OpenAI-compatible or Gemini)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from fastapi import HTTPException

from app.config import get_settings
from app.models import (
    AiPolicy,
    KnowledgeChunk,
    Lead,
    Message,
    MessageDirection,
    PlatformSetting,
    SenderType,
)
from app.services import gemini, openai_compat
from app.services.embeddings import cosine, embed_text

AI_DEFAULTS_KEY = "ai_defaults"
# Recent turns included in LLM context (inbound + outbound)
CHAT_HISTORY_LIMIT = 12
CHAT_HISTORY_MSG_CHARS = 500

DEFAULT_PLATFORM_SYSTEM = (
    "تو دستیار فروش و پشتیبانی یک کسب‌وکار ایرانی هستی. "
    "پاسخ را کوتاه، مودب و به فارسی بنویس. "
    "از تاریخچه گفتگو برای حفظ زمینه استفاده کن و تکرار سوال‌های قبلی را نکن."
)

DEFAULT_FALLBACK_MESSAGE = (
    "سلام، پیام شما دریافت شد. همکاران ما به‌زودی پاسخ می‌دهند."
)

PROVIDERS = ("openai_compatible", "gemini")


def get_platform_ai_settings(db: Session) -> dict:
    """Load platform AI config from DB on every call (no cache — changes apply immediately)."""
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
        "fallback_message": DEFAULT_FALLBACK_MESSAGE,
        "default_min_confidence": 0.0,
        "auto_send_default": False,
        "notes": "",
        # legacy Gemini fields
        "gemini_api_key": getattr(settings, "gemini_api_key", "") or "",
        "gemini_model": getattr(settings, "gemini_model", "") or gemini.DEFAULT_MODEL,
        "openai_model": getattr(settings, "openai_model", "") or "",
        "openai_base_url": getattr(settings, "openai_base_url", "") or "",
        "pinecone_api_key": getattr(settings, "pinecone_api_key", "") or "",
    }
    row = db.get(PlatformSetting, AI_DEFAULTS_KEY)
    if row and isinstance(row.value, dict):
        for k, v in row.value.items():
            if v is None:
                continue
            # Never wipe stored secrets with empty strings from partial merges
            if k in ("api_key", "gemini_api_key", "openai_api_key", "pinecone_api_key") and not str(v).strip():
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
        if (base.get("api_key") or "").strip() or (
            (base.get("base_url") or "").strip()
            and "generativelanguage" not in (base.get("base_url") or "")
        ):
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
    if not (base.get("fallback_message") or "").strip():
        base["fallback_message"] = DEFAULT_FALLBACK_MESSAGE

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
    """Call configured provider. Returns {reply, provider, model}. Raises on provider errors."""
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
    """Top-k knowledge chunks for RAG. Prefer Pinecone when configured."""
    from types import SimpleNamespace

    from app.services import pinecone_kb

    if pinecone_kb.is_configured(db):
        try:
            hits = pinecone_kb.search(org_id=org_id, query=query, k=k, db=db)
            out: list[tuple[KnowledgeChunk, float]] = []
            for h in hits:
                # Ephemeral stand-in with .content for prompt formatters
                chunk = SimpleNamespace(
                    id=h.id,
                    content=h.content,
                    doc_id=h.doc_id,
                    org_id=org_id,
                    embedding=[],
                )
                out.append((chunk, float(h.score)))  # type: ignore[arg-type]
            if out:
                return out
        except Exception as exc:  # noqa: BLE001
            from app.services.stdio_utf8 import safe_print

            safe_print(f"[ai_reply] Pinecone search failed, SQLite fallback: {exc}")

    qv = embed_text(query)
    chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.org_id == org_id).all()
    scored = [(c, cosine(qv, c.embedding or [])) for c in chunks]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]


def _platform_system_prompt(platform: dict) -> str:
    """Super-admin system prompt only."""
    return (platform.get("system_prompt") or "").strip() or DEFAULT_PLATFORM_SYSTEM


def _business_role_text(policy: AiPolicy | None) -> str:
    """Business role prompt (agent_role). Legacy org system_prompt is merged for backward compat."""
    if not policy:
        return ""
    role = (getattr(policy, "agent_role", None) or "").strip()
    legacy = (getattr(policy, "system_prompt", None) or "").strip()
    if role and legacy:
        text = f"{role}\n\n{legacy}"
    else:
        text = role or legacy
    if len(text) > 1200:
        return text[:1200] + "…"
    return text


def _format_knowledge_blocks(hits: list[tuple[KnowledgeChunk, float]]) -> str:
    blocks: list[str] = []
    for i, (chunk, score) in enumerate(hits, start=1):
        if score < 0.02:
            continue
        blocks.append(f"[{i}] (امتیاز {score:.2f})\n{chunk.content[:400]}")
    return "\n\n".join(blocks)


def _compose_llm_prompts(
    *,
    platform: dict,
    policy: AiPolicy | None,
    lead: Lead | None,
    message: str,
    hits: list[tuple[KnowledgeChunk, float]],
    history_text: str = "",
) -> tuple[str, str]:
    """
    Prompt stack:
      1) platform system prompt (super-admin)
      2) business role + knowledge base
      3) user message + chat history
    """
    system_sections = [_platform_system_prompt(platform)]

    business_sections: list[str] = []
    role = _business_role_text(policy)
    if role:
        business_sections.append(f"## نقش این کسب‌وکار\n{role}")

    kb_text = _format_knowledge_blocks(hits)
    if kb_text:
        business_sections.append(f"## دانش سازمانی\n{kb_text}")

    if business_sections:
        system_sections.append("\n\n".join(business_sections))

    system_prompt = "\n\n---\n\n".join(system_sections)

    lead_name = (lead.name if lead else "") or "مشتری"
    lead_stage = (lead.stage if lead else "") or "-"
    history = (history_text or "").strip() or "(بدون تاریخچه قبلی)"
    user_prompt = (
        f"نام لید: {lead_name}\n"
        f"مرحله  قیف : {lead_stage}\n\n"
        f"تاریخچه گفتگو (قدیمی → جدید):\n{history}\n\n"
        f"آخرین پیام مشتری:\n{message.strip()}\n\n"
        "یک پاسخ مناسب برای ارسال به مشتری بنویس. فقط متن پاسخ را برگردان."
    )
    return system_prompt, user_prompt


def _clip_msg(text: str, limit: int = CHAT_HISTORY_MSG_CHARS) -> str:
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    return t[:limit] + "…"


def _speaker_label(m: Message) -> str:
    if m.direction == MessageDirection.inbound or m.sender_type == SenderType.customer:
        return "مشتری"
    if m.sender_type == SenderType.ai:
        return "دستیار"
    if m.sender_type == SenderType.system:
        return "سیستم"
    return "عامل"


def load_chat_history(
    db: Session,
    *,
    org_id: str,
    lead_id: str,
    limit: int = CHAT_HISTORY_LIMIT,
) -> list[Message]:
    """Oldest → newest, last `limit` messages for this lead."""
    rows = (
        db.query(Message)
        .filter(Message.org_id == org_id, Message.lead_id == lead_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(max(1, min(int(limit), 40)))
        .all()
    )
    rows.reverse()
    return rows


def format_chat_history(
    messages: list[Message],
    *,
    current_message: str = "",
) -> str:
    """Format CRM messages for the prompt; ensure current inbound is present."""
    lines: list[str] = []
    for m in messages:
        body = _clip_msg(m.body or "")
        if not body:
            continue
        lines.append(f"{_speaker_label(m)}: {body}")

    cur = _clip_msg(current_message)
    if cur:
        expected = f"مشتری: {cur}"
        if not lines or lines[-1] != expected:
            if not (lines and lines[-1].startswith("مشتری:") and lines[-1][len("مشتری: ") :] == cur):
                lines.append(expected)

    return "\n".join(lines) if lines else "(بدون تاریخچه قبلی)"


def resolve_fallback_message(
    db: Session,
    *,
    org_id: str,
    policy: AiPolicy | None = None,
    platform: dict | None = None,
) -> str:
    """Org override wins; else platform global; else hardcoded default."""
    if policy is None:
        policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
    org_fb = (getattr(policy, "fallback_message", None) or "").strip() if policy else ""
    if org_fb:
        return org_fb
    plat = platform if platform is not None else get_platform_ai_settings(db)
    plat_fb = (plat.get("fallback_message") or "").strip()
    if plat_fb:
        return plat_fb
    return DEFAULT_FALLBACK_MESSAGE


def _fallback_result(
    reply: str, *, reason: str = "provider_error", error_detail: str = ""
) -> dict:
    return {
        "reply": reply,
        "confidence": 0.0,
        "sources": [],
        "provider": "fallback",
        "model": "",
        "fallback_reason": reason,
        "error_detail": (error_detail or "")[:240],
    }


def _knowledge_sources(hits: list[tuple[KnowledgeChunk, float]]) -> list[str]:
    return [h[0].content[:120] for h in hits if h[1] > 0.05]


def generate_reply(
    db: Session,
    *,
    org_id: str,
    lead: Lead | None,
    message: str,
    history_limit: int = CHAT_HISTORY_LIMIT,
) -> dict:
    """Return {reply, confidence, sources, provider, model}. Fallback only when AI provider fails."""
    platform = get_platform_ai_settings(db)
    policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
    fallback_text = resolve_fallback_message(
        db, org_id=org_id, policy=policy, platform=platform
    )
    hits = retrieve_knowledge(db, org_id, message, k=4)
    top_score = float(hits[0][1]) if hits else 0.0
    sources = _knowledge_sources(hits)

    history_msgs: list[Message] = []
    if lead and lead.id:
        history_msgs = load_chat_history(
            db, org_id=org_id, lead_id=lead.id, limit=history_limit
        )
    history_text = format_chat_history(history_msgs, current_message=message)

    if not llm_is_configured(platform):
        return _fallback_result(fallback_text, reason="llm_not_configured")

    system_prompt, user_prompt = _compose_llm_prompts(
        platform=platform,
        policy=policy,
        lead=lead,
        message=message,
        hits=hits,
        history_text=history_text,
    )
    reply_platform = {
        **platform,
        "max_tokens": min(int(platform.get("max_tokens") or 2048), 768),
    }
    try:
        out = generate_llm_text(
            reply_platform, system_prompt=system_prompt, user_prompt=user_prompt
        )
    except HTTPException as e:
        from app.services.stdio_utf8 import safe_print

        detail = e.detail if isinstance(e.detail, str) else str(e.detail)
        safe_print(f"[ai_reply] LLM failed, using fallback: {detail}")
        reason = "rate_limit" if "rate limit" in detail.lower() or "محدودیت نرخ" in detail else "provider_error"
        return _fallback_result(fallback_text, reason=reason, error_detail=detail)
    except Exception as e:  # noqa: BLE001
        from app.services.stdio_utf8 import safe_print

        safe_print(f"[ai_reply] LLM failed, using fallback: {e}")
        return _fallback_result(fallback_text, reason="provider_error", error_detail=str(e)[:240])

    reply = (out.get("reply") or "").strip()
    if not reply:
        return _fallback_result(fallback_text, reason="empty_reply")

    confidence = round(max(0.5, min(0.98, 0.55 + top_score * 0.4)), 3)
    return {
        "reply": reply,
        "confidence": confidence,
        "sources": sources,
        "provider": out["provider"],
        "model": out.get("model") or "",
        "history_messages": len(history_msgs),
        "knowledge_top_score": round(top_score, 3),
        "knowledge_hits": len(sources),
    }


def playground_reply(
    db: Session,
    *,
    message: str,
    org_id: str | None = None,
    lead_id: str | None = None,
    lead_name: str = "مشتری تست",
    lead_stage: str = "جدید",
    system_prompt_override: str | None = None,
    agent_role_override: str | None = None,
    temperature: float = 0.4,
) -> dict:
    """Super-admin playground — same prompt stack as production auto-reply."""
    platform = get_platform_ai_settings(db)
    if not llm_is_configured(platform):
        raise ValueError("سرویس AI پیکربندی نشده — کلید و Base URL را در تنظیمات AI ذخیره کنید")

    policy: AiPolicy | None = None
    hits: list[tuple[KnowledgeChunk, float]] = []
    lead: Lead | None = None
    history_msgs: list[Message] = []
    if org_id:
        policy = db.query(AiPolicy).filter(AiPolicy.org_id == org_id).first()
        hits = retrieve_knowledge(db, org_id, message, k=4)
        if lead_id:
            lead = (
                db.query(Lead)
                .filter(Lead.id == lead_id, Lead.org_id == org_id)
                .first()
            )
            if lead:
                lead_name = lead.name or lead_name
                lead_stage = lead.stage or lead_stage
                history_msgs = load_chat_history(
                    db, org_id=org_id, lead_id=lead.id, limit=CHAT_HISTORY_LIMIT
                )

    if system_prompt_override is not None and system_prompt_override.strip():
        platform = {**platform, "system_prompt": system_prompt_override.strip()}

    if agent_role_override and agent_role_override.strip():
        policy = policy or AiPolicy(org_id=org_id or "")
        policy.agent_role = agent_role_override.strip()

    if not org_id:
        # No business context — platform system prompt only
        policy = None
        hits = []

    history_text = format_chat_history(history_msgs, current_message=message)
    system_prompt, user_prompt = _compose_llm_prompts(
        platform=platform,
        policy=policy,
        lead=lead or Lead(name=lead_name, stage=lead_stage),
        message=message,
        hits=hits,
        history_text=history_text,
    )

    out = generate_llm_text(
        platform,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=float(temperature),
    )
    top_score = float(hits[0][1]) if hits else 0.0
    sources = _knowledge_sources(hits)
    confidence = round(max(0.5, min(0.98, 0.55 + top_score * 0.4)), 3)

    return {
        "reply": out["reply"],
        "confidence": confidence,
        "sources": sources,
        "provider": out["provider"],
        "model": out.get("model") or resolve_model(platform),
        "system_prompt_used": system_prompt,
        "knowledge_hits": len(sources),
        "history_messages": len(history_msgs),
        "org_id": org_id or "",
        "base_url": (platform.get("base_url") or "") if platform.get("provider") != "gemini" else "",
    }
