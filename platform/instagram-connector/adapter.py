"""Small Bidar-facing wrapper around the verified instagrapi Client API."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class InstagramAdapter:
    def __init__(self, *, settings: dict[str, Any] | None = None, proxy: str = "") -> None:
        from instagrapi import Client

        self.client = Client(proxy=proxy or None)
        if settings:
            self.client.set_settings(settings)

    def settings(self) -> dict[str, Any]:
        return self.client.get_settings()

    def load_settings_json(self, payload: str) -> None:
        settings = json.loads(payload or "{}")
        if settings:
            self.client.set_settings(settings)

    def dump_settings_json(self) -> str:
        return json.dumps(self.client.get_settings(), ensure_ascii=False)

    def login(self, username: str, password: str, verification_code: str = "") -> bool:
        return bool(self.client.login(username, password, verification_code=verification_code))

    def relogin(self) -> bool:
        return bool(self.client.relogin())

    def profile(self) -> Any:
        return self.client.account_info()

    def user_info(self, user_id: str) -> Any:
        return self.client.user_info(user_id)

    def user_info_by_username(self, username: str) -> Any:
        return self.client.user_info_by_username(username)

    def direct_threads(self, amount: int = 20) -> list[Any]:
        return self.client.direct_threads(amount=amount)

    def direct_messages(self, thread_id: int, amount: int = 20) -> list[Any]:
        return self.client.direct_messages(thread_id=thread_id, amount=amount)

    def user_medias(self, user_id: str, amount: int = 20) -> list[Any]:
        return self.client.user_medias(user_id=user_id, amount=amount)

    def send_text(self, thread_id: int, text: str) -> Any:
        return self.client.direct_answer(thread_id=thread_id, text=text)

    def media_comments(self, media_id: str, amount: int = 20) -> list[Any]:
        return self.client.media_comments(media_id=media_id, amount=amount)

    def media_comment_replies(self, media_id: str, comment_id: str, amount: int = 0) -> list[Any]:
        return self.client.media_comment_replies(
            media_id=media_id,
            comment_id=comment_id,
            amount=amount,
        )

    def reply_to_comment(self, media_id: str, text: str, parent_comment_id: int | None = None) -> Any:
        return self.client.media_comment(
            media_id=media_id,
            text=text,
            replied_to_comment_id=parent_comment_id,
        )

    @staticmethod
    def serialize(value: Any) -> dict[str, Any]:
        if hasattr(value, "model_dump"):
            return value.model_dump()
        if hasattr(value, "dict"):
            return value.dict()
        if isinstance(value, dict):
            return value
        return dict(vars(value))
