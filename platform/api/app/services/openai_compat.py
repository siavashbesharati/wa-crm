"""OpenAI-compatible chat completions (OpenAI, Groq, xAI, Together, …)."""

from __future__ import annotations

import logging
import re
import time
from typing import Any

import httpx
from fastapi import HTTPException

logger = logging.getLogger("openai_compat")

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"
RATE_LIMIT_RETRIES = 4

# Common presets for the admin UI / docs
PROVIDER_PRESETS = {
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "groq": {
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    "xai": {
        "label": "xAI Grok",
        "base_url": "https://api.x.ai/v1",
        "model": "grok-2-latest",
    },
}


def _normalize_base_url(base_url: str) -> str:
    url = (base_url or DEFAULT_BASE_URL).strip().rstrip("/")
    if not url:
        url = DEFAULT_BASE_URL
    # Accept either …/v1 or full host; chat path is /chat/completions
    return url


def _parse_retry_seconds(body: str) -> float:
    """Groq/OpenAI rate-limit bodies often say 'try again in 1.02s'."""
    m = re.search(r"try again in\s+([\d.]+)\s*s", body or "", re.I)
    if not m:
        return 0.0
    try:
        return max(0.5, float(m.group(1)))
    except ValueError:
        return 0.0


def _provider_error_detail(status: int, body: str) -> str:
    text = (body or "").strip()
    if status == 429 or "rate_limit" in text.lower():
        wait = _parse_retry_seconds(text)
        if wait:
            return f"محدودیت نرخ Groq/API — دوباره بعد از {wait:.1f} ثانیه"
        return "محدودیت نرخ Groq/API (rate limit)"
    if status == 401:
        return "کلید API نامعتبر است"
    if status == 404 and "model" in text.lower():
        return "مدل AI یافت نشد — نام مدل را در سوپرادمین بررسی کنید"
    if text:
        return text[:240]
    return "خطا از سرویس AI — کلید، Base URL یا مدل را بررسی کنید"


def chat_completion(
    *,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.4,
    max_tokens: int = 2048,
    top_p: float = 1.0,
    reasoning_effort: str | None = None,
    timeout: float = 60.0,
) -> str:
    key = (api_key or "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="کلید API تنظیم نشده — از سوپر ادمین → تنظیمات AI وارد کنید",
        )
    model_id = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    root = _normalize_base_url(base_url)
    url = f"{root}/chat/completions"

    messages: list[dict[str, str]] = []
    sys = (system_prompt or "").strip()
    if sys:
        messages.append({"role": "system", "content": sys})
    messages.append({"role": "user", "content": (user_prompt or "").strip()})

    payload: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
        "top_p": float(top_p),
        "stream": False,
    }
    effort = (reasoning_effort or "").strip()
    if effort:
        # Supported by some Groq / reasoning models; ignored by others if rejected we strip below
        payload["reasoning_effort"] = effort

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            res = None
            for attempt in range(RATE_LIMIT_RETRIES):
                res = client.post(url, headers=headers, json=payload)
                # Some gateways reject unknown fields — retry without reasoning_effort
                if res.status_code >= 400 and effort and "reasoning" in (res.text or "").lower():
                    payload.pop("reasoning_effort", None)
                    res = client.post(url, headers=headers, json=payload)
                if res.status_code == 429 and attempt < RATE_LIMIT_RETRIES - 1:
                    wait = _parse_retry_seconds(res.text or "")
                    if not wait:
                        wait = min(8.0, 1.5 * (attempt + 1))
                    logger.warning(
                        "openai-compat rate limit (attempt %s/%s), sleeping %.1fs",
                        attempt + 1,
                        RATE_LIMIT_RETRIES,
                        wait,
                    )
                    time.sleep(wait)
                    continue
                break
    except httpx.HTTPError as e:
        logger.error("openai-compat network error: %s", e)
        raise HTTPException(status_code=502, detail="ارتباط با سرویس AI برقرار نشد") from e

    assert res is not None
    if res.status_code >= 400:
        logger.error("openai-compat HTTP %s: %s", res.status_code, res.text[:500])
        raise HTTPException(
            status_code=502,
            detail=_provider_error_detail(res.status_code, res.text or ""),
        )

    data = res.json()
    try:
        choice = data["choices"][0]
        msg = choice.get("message") or {}
        text = (msg.get("content") or "").strip()
        if not text:
            # rare: some models put text in refusal / reasoning fields
            text = (msg.get("reasoning") or choice.get("text") or "").strip()
    except (KeyError, IndexError, TypeError):
        logger.error("openai-compat unexpected response: %s", str(data)[:500])
        raise HTTPException(status_code=502, detail="پاسخ نامعتبر از سرویس AI")

    if not text:
        raise HTTPException(status_code=502, detail="سرویس AI پاسخ خالی برگرداند")
    return text
