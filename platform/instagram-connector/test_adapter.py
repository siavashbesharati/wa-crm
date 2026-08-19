from __future__ import annotations

from unittest.mock import Mock, patch

from adapter import InstagramAdapter


def test_adapter_uses_verified_instagram_client_methods() -> None:
    client = Mock()
    client.get_settings.return_value = {"device_settings": {"app_version": "test"}}
    with patch("instagrapi.Client", return_value=client):
        adapter = InstagramAdapter(settings={"device_settings": {"app_version": "restored"}})

    client.set_settings.assert_called_once()
    assert adapter.dump_settings_json().startswith("{")
    client.get_settings.assert_called_once()

    adapter.login("alice", "secret", verification_code="123456")
    client.login.assert_called_once_with("alice", "secret", verification_code="123456")

    adapter.send_text("instagram:thread:42", "hello")
    client.direct_answer.assert_called_once_with(thread_id=42, text="hello")

    adapter.send_text("instagram:user:99", "hello")
    client.direct_send.assert_called_once_with(text="hello", user_ids=[99])

    adapter.reply_to_comment("media-1", "thanks", 7)
    client.media_comment.assert_called_once_with(
        media_id="media-1",
        text="thanks",
        replied_to_comment_id=7,
    )
