"""Non-interactive Divar OTP auth (same endpoints as `divar.Client.authorize`)."""

from __future__ import annotations

import base64
import json
import random
import re
import time
from typing import Any

import requests

from app.services.phone import ascii_digits, normalize_ir_mobile, normalize_phone_for_storage

API = "https://api.divar.ir"

_UA = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
)


class DivarAuthError(Exception):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _normalize_phone(phone: str) -> str:
    try:
        return normalize_ir_mobile(phone)
    except ValueError as exc:
        raise DivarAuthError("شماره باید مثل 09123456789 باشد") from exc


def _new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "accept": "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9,fa;q=0.8",
            "origin": "https://divar.ir",
            "referer": "https://divar.ir/",
            "user-agent": _UA,
            "x-screen-size": random.choice(
                ["390x844", "430x932", "360x780", "384x854", "412x915"]
            ),
        }
    )
    return s


def send_otp(phone: str) -> dict[str, Any]:
    """Send SMS OTP. Returns pending dict for consume_otp."""
    local = _normalize_phone(phone)
    e164 = "+98" + local.lstrip("0")
    sess = _new_session()
    sess.get("https://divar.ir/", timeout=15)
    time.sleep(0.2)
    r = sess.post(
        f"{API}/v8/authenticate/signinup/code",
        headers={
            **sess.headers,
            "content-type": "application/json",
            "rid": "passwordless",
            "st-auth-mode": "cookie",
        },
        json={"phoneNumber": e164},
        timeout=20,
    )
    if r.status_code != 200:
        raise DivarAuthError(
            f"ارسال کد ناموفق بود ({r.status_code})",
            status_code=502,
        )
    data = r.json()
    device_id = data.get("deviceId")
    pre = data.get("preAuthSessionId")
    if not device_id or not pre:
        raise DivarAuthError("پاسخ OTP ناقص است", status_code=502)
    return {
        "phone": local,
        "deviceId": device_id,
        "preAuthSessionId": pre,
        "cookies": sess.cookies.get_dict(),
        "user_agent": sess.headers.get("user-agent", ""),
        "x_screen_size": sess.headers.get("x-screen-size", ""),
    }


def consume_otp(pending: dict[str, Any], code: str) -> dict[str, Any]:
    """Complete OTP; returns cookies dict + account phone/user_id."""
    code = ascii_digits(code or "")
    if not re.fullmatch(r"^\d{6}$", code):
        raise DivarAuthError("کد تأیید باید ۶ رقم باشد")

    sess = _new_session()
    if pending.get("user_agent"):
        sess.headers["user-agent"] = pending["user_agent"]
    if pending.get("x_screen_size"):
        sess.headers["x-screen-size"] = pending["x_screen_size"]
    for name, value in (pending.get("cookies") or {}).items():
        sess.cookies.set(name=name, value=value, domain=".divar.ir", path="/")

    r = sess.post(
        f"{API}/v8/authenticate/signinup/code/consume",
        headers={
            **sess.headers,
            "content-type": "application/json",
            "rid": "passwordless",
            "st-auth-mode": "cookie",
        },
        json={
            "deviceId": pending["deviceId"],
            "preAuthSessionId": pending["preAuthSessionId"],
            "userInputCode": code,
        },
        timeout=20,
    )
    try:
        data = r.json()
    except ValueError as exc:
        raise DivarAuthError("پاسخ نامعتبر از دیوار", status_code=502) from exc
    if not (r.status_code == 200 and data.get("status") == "OK"):
        raise DivarAuthError("کد تأیید اشتباه است")

    s_front = r.headers.get("Front-Token")
    if not s_front:
        access = sess.cookies.get(name="sAccessToken", domain=".divar.ir", path="/") or ""
        if not access:
            access = sess.cookies.get("sAccessToken") or ""
        if access and "." in access:
            s_front = access.split(".")[1]
    if s_front:
        sess.cookies.set(name="sFrontToken", value=s_front, domain=".divar.ir", path="/")

    cookies = sess.cookies.get_dict()
    phone = normalize_phone_for_storage(pending.get("phone") or "")
    user_id = ""
    try:
        token = cookies.get("sFrontToken") or s_front or ""
        b64 = token + ("=" * ((4 - len(token) % 4) % 4))
        payload = json.loads(base64.urlsafe_b64decode(b64))
        user_id = str(payload.get("uid") or (payload.get("up") or {}).get("sub") or "")
        jwt_phone = str((payload.get("up") or {}).get("phoneNumber") or "")
        phone = normalize_phone_for_storage(jwt_phone) or phone
    except Exception:  # noqa: BLE001
        pass

    return {
        "cookies": cookies,
        "phone": phone,
        "user_id": user_id,
        "user_agent": sess.headers.get("user-agent", ""),
        "x_screen_size": sess.headers.get("x-screen-size", ""),
    }


def verify_cookies(cookies: dict[str, Any]) -> bool:
    sess = _new_session()
    for name, value in (cookies or {}).items():
        sess.cookies.set(name=name, value=value, domain=".divar.ir", path="/")
    r = sess.get(f"{API}/v8/user-profile/user-nationality", timeout=15)
    return r.status_code == 200
