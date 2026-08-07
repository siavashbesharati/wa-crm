"""SMS.ir verify OTP sender — templates from DB (super-admin) with env fallback."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger("sms_ir")


def normalize_mobile_for_sms_ir(phone: str) -> str:
    """sms.ir expects Iranian mobile like 912xxxxxxx (no leading 0 / 98)."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("98") and len(digits) >= 12:
        digits = digits[2:]
    if digits.startswith("0"):
        digits = digits[1:]
    if len(digits) < 10:
        raise HTTPException(status_code=400, detail="شماره موبایل نامعتبر است")
    return digits


def _normalize_parameters(raw: list | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in raw or []:
        if isinstance(item, str):
            name = item.strip()
            if name:
                out.append({"name": name, "source": "otp" if not out else "static", "value": ""})
            continue
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        source = str(item.get("source") or "otp").strip().lower()
        if source not in ("otp", "static"):
            source = "otp"
        out.append(
            {
                "name": name,
                "source": source,
                "value": str(item.get("value") or ""),
            }
        )
    return out


def resolve_otp_template(db: Session | None = None) -> dict[str, Any]:
    """Active default OTP template from DB, else settings/env fallback."""
    settings = get_settings()
    if db is not None:
        from app.models import SmsTemplate

        row = (
            db.query(SmsTemplate)
            .filter(
                SmsTemplate.purpose == "otp",
                SmsTemplate.is_active.is_(True),
                SmsTemplate.is_default.is_(True),
            )
            .order_by(SmsTemplate.updated_at.desc())
            .first()
        )
        if not row:
            row = (
                db.query(SmsTemplate)
                .filter(SmsTemplate.purpose == "otp", SmsTemplate.is_active.is_(True))
                .order_by(SmsTemplate.updated_at.desc())
                .first()
            )
        if row and int(row.template_id or 0) > 0:
            params = _normalize_parameters(list(row.parameters or []))
            if not params:
                param = (settings.sms_ir_otp_param or "OTP").strip() or "OTP"
                params = [{"name": param, "source": "otp", "value": ""}]
            return {
                "id": row.id,
                "name": row.name,
                "template_id": int(row.template_id),
                "parameters": params,
                "source": "db",
            }

    tid = int(settings.sms_ir_template_id or 0)
    param = (settings.sms_ir_otp_param or "OTP").strip() or "OTP"
    if tid <= 0:
        raise HTTPException(
            status_code=503,
            detail="قالب OTP تعریف نشده — در سوپر ادمین یک قالب بسازید یا SMS_IR_TEMPLATE_ID را تنظیم کنید",
        )
    return {
        "id": None,
        "name": "config",
        "template_id": tid,
        "parameters": [{"name": param, "source": "otp", "value": ""}],
        "source": "config",
    }


def build_verify_parameters(template: dict[str, Any], *, otp_code: str) -> list[dict[str, str]]:
    params_out: list[dict[str, str]] = []
    for p in template.get("parameters") or []:
        name = str(p.get("name") or "").strip()
        if not name:
            continue
        if (p.get("source") or "otp") == "otp":
            params_out.append({"name": name, "value": str(otp_code)})
        else:
            params_out.append({"name": name, "value": str(p.get("value") or "")})
    if not params_out:
        params_out = [{"name": "Code", "value": str(otp_code)}]
    return params_out


def send_otp(phone: str, code: str, *, db: Session | None = None) -> None:
    """Send verification SMS via sms.ir /v1/send/verify."""
    settings = get_settings()
    api_key = (settings.sms_ir_api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="سرویس پیامک پیکربندی نشده است (SMS_IR_API_KEY)",
        )

    template = resolve_otp_template(db)
    template_id = int(template["template_id"])
    parameters = build_verify_parameters(template, otp_code=code)

    mobile = normalize_mobile_for_sms_ir(phone)
    payload = {
        "mobile": mobile,
        "templateId": template_id,
        "parameters": parameters,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "https://api.sms.ir/v1/send/verify",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-api-key": api_key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            raw = res.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        logger.error("sms.ir HTTP %s: %s", e.code, err_body)
        raise HTTPException(
            status_code=502,
            detail="ارسال پیامک ناموفق بود — بعداً دوباره تلاش کنید",
        ) from e
    except urllib.error.URLError as e:
        logger.error("sms.ir network error: %s", e)
        raise HTTPException(
            status_code=502,
            detail="ارتباط با سرویس پیامک برقرار نشد",
        ) from e

    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        logger.error("sms.ir invalid JSON: %s", raw[:300])
        raise HTTPException(status_code=502, detail="پاسخ نامعتبر از سرویس پیامک")

    status = data.get("status")
    if status != 1:
        msg = data.get("message") or "خطا در ارسال پیامک"
        logger.error("sms.ir failed status=%s message=%s", status, msg)
        raise HTTPException(status_code=502, detail=str(msg))

    logger.info(
        "sms.ir OTP sent mobile=%s templateId=%s messageId=%s",
        mobile,
        template_id,
        (data.get("data") or {}).get("messageId"),
    )
