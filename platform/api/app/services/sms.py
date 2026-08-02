import logging

from app.config import get_settings

logger = logging.getLogger("mock_sms")


def send_otp(phone: str, code: str) -> None:
    """Mock SMS provider — logs OTP instead of sending."""
    settings = get_settings()
    logger.info("[MOCK SMS] phone=%s code=%s env=%s", phone, code, settings.app_env)
    print(f"[MOCK SMS] OTP for {phone}: {code}")
