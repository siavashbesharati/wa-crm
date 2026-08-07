"""Google Gemini generateContent client."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException

logger = logging.getLogger("gemini")

DEFAULT_MODEL = "gemini-2.0-flash"


def generate_text(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.4,
    max_output_tokens: int = 1024,
) -> str:
    key = (api_key or "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="کلید Gemini تنظیم نشده — از سوپر ادمین → تنظیمات AI وارد کنید",
        )
    model_id = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model_id}:generateContent"
    )
    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
        },
    }
    sys = (system_prompt or "").strip()
    if sys:
        payload["system_instruction"] = {"parts": [{"text": sys}]}

    try:
        with httpx.Client(timeout=45.0) as client:
            res = client.post(url, params={"key": key}, json=payload)
    except httpx.HTTPError as e:
        logger.error("gemini network error: %s", e)
        raise HTTPException(status_code=502, detail="ارتباط با Gemini برقرار نشد") from e

    if res.status_code >= 400:
        logger.error("gemini HTTP %s: %s", res.status_code, res.text[:500])
        raise HTTPException(
            status_code=502,
            detail="خطا از سرویس Gemini — کلید/مدل را بررسی کنید",
        )

    data = res.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(str(p.get("text") or "") for p in parts).strip()
    except (KeyError, IndexError, TypeError):
        logger.error("gemini unexpected response: %s", str(data)[:500])
        raise HTTPException(status_code=502, detail="پاسخ نامعتبر از Gemini")

    if not text:
        raise HTTPException(status_code=502, detail="Gemini پاسخ خالی برگرداند")
    return text
