"""Instagram session-ID authentication helpers."""

from __future__ import annotations


class InstagramAuthError(Exception):
    """Raised when Instagram rejects the supplied session ID."""


class InstagramRateLimited(Exception):
    """Raised when Instagram throttles us (HTTP 429) — session may still be valid."""


_RATE_LIMIT_NEEDLES = (
    "429",
    "too many requests",
    "rate limit",
    "please wait a few minutes",
)


def is_rate_limited(exc: BaseException) -> bool:
    name = type(exc).__name__.lower()
    msg = str(exc or "").lower()
    for needle in _RATE_LIMIT_NEEDLES:
        if needle in name or needle in msg:
            return True
    return False


async def validate_session(session_id: str) -> tuple[str, str]:
    """Authenticate with aiograpi and return public account metadata."""
    if not session_id:
        raise InstagramAuthError("empty session")
    try:
        from aiograpi import Client
    except ImportError as exc:
        raise InstagramAuthError("aiograpi is not installed") from exc

    client = Client()
    try:
        await client.login_by_sessionid(session_id)
        user_id = str(getattr(client, "user_id", "") or "")
        username = str(getattr(client, "username", "") or "")
        if not username and user_id:
            try:
                info = await client.user_info_by_user_id(int(user_id))
                username = str(getattr(info, "username", "") or "")
            except Exception:
                pass
        if not user_id and not username:
            raise InstagramAuthError("missing account metadata")
        return username, user_id
    except InstagramAuthError:
        raise
    except Exception as exc:  # noqa: BLE001
        if is_rate_limited(exc):
            raise InstagramRateLimited(str(exc)) from exc
        raise InstagramAuthError("Instagram rejected session") from exc
