"""Stable Bale peer/message identifiers."""

from __future__ import annotations

import unittest
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mapper import (  # noqa: E402
    is_bot_peer,
    map_history_message,
    map_new_message_event,
    message_external_id,
    normalize_visible_phone,
    parse_peer_key,
    peer_display_name,
    peer_key,
    phone_from_contact_records,
)


class TestPeerKeys(unittest.TestCase):
    def test_user_key(self):
        self.assertEqual(peer_key(1, 381966434), "bale:user:381966434")

    def test_group_key(self):
        self.assertEqual(peer_key(2, 99), "bale:group:99")

    def test_parse(self):
        self.assertEqual(parse_peer_key("bale:user:381966434"), ("user", 381966434))
        self.assertEqual(parse_peer_key("bale:group:10"), ("group", 10))

    def test_parse_misstagged_wa_jid(self):
        self.assertEqual(parse_peer_key("381966434@s.whatsapp.net"), ("user", 381966434))

    def test_message_id(self):
        self.assertEqual(message_external_id(1, 381966434, 55), "bale:1:381966434:55")

    def test_peer_id_is_not_a_phone(self):
        self.assertEqual(normalize_visible_phone("381966434"), "")
        self.assertEqual(normalize_visible_phone("09121234567"), "09121234567")
        self.assertEqual(normalize_visible_phone("989121234567"), "09121234567")

    def test_display_name_prefers_title(self):
        ext = "bale:user:381966434"
        self.assertEqual(peer_display_name("علی رضایی", "", ext), "علی رضایی")
        self.assertEqual(peer_display_name("", "ali", ext), "@ali")
        self.assertEqual(peer_display_name("", "", ext), ext)

    def test_phone_from_contact_records(self):
        rec = SimpleNamespace(stringValue=SimpleNamespace(value="09121234567"), title=None, subtitle=None, longValue=None)
        self.assertEqual(phone_from_contact_records([rec]), "09121234567")


class TestBotDetection(unittest.TestCase):
    def test_is_bot_peer_by_username_suffix(self):
        self.assertTrue(is_bot_peer(1, "mybot"))
        self.assertTrue(is_bot_peer(1, "@Shop_Bot"))
        self.assertTrue(is_bot_peer(1, "support-bot"))
        self.assertFalse(is_bot_peer(1, "ali"))
        self.assertFalse(is_bot_peer(1, ""))
        self.assertFalse(is_bot_peer(1, None))
        # Groups are never bots even with a bot-like name
        self.assertFalse(is_bot_peer(2, "mybot"))

    def test_is_bot_peer_official_bale_handle(self):
        # Official Bale service bots use the bare handle 'bale'
        self.assertTrue(is_bot_peer(1, "bale"))
        self.assertTrue(is_bot_peer(1, "@bale"))
        self.assertTrue(is_bot_peer(1, "@Bale"))

    def test_is_bot_peer_title_as_handle_fallback(self):
        # When username lookup fails the handle may surface as the display title
        self.assertTrue(is_bot_peer(1, "", "@post_bot"))
        self.assertTrue(is_bot_peer(1, None, "@bale"))
        # Human names / non-handle titles are not bots
        self.assertFalse(is_bot_peer(1, "", "علی رضایی"))
        self.assertFalse(is_bot_peer(1, "", "post bot support"))

    def _event(self, rid=77):
        return SimpleNamespace(
            id=rid,
            rid=rid,
            sender_id=999,
            peer=SimpleNamespace(type=1, id=381966434),
            content=SimpleNamespace(kind="text", text="سلام"),
            text="سلام",
            is_group=False,
        )

    def _entry(self, rid=55):
        return SimpleNamespace(
            rid=rid,
            sender_id=999,
            content=SimpleNamespace(kind="text", text="سلام"),
        )

    def test_new_message_title_handle_only_is_bot(self):
        # username lookup failed; handle visible only as '@post_bot' title
        payload = map_new_message_event(
            account_id="acc",
            event=self._event(),
            title="@post_bot",
            me_id=1,
            username="",
        )
        assert payload is not None
        self.assertEqual(payload["chat_type"], "bot")

    def test_new_message_official_bale_username_is_bot(self):
        payload = map_new_message_event(
            account_id="acc",
            event=self._event(),
            title="بله",
            me_id=1,
            username="bale",
        )
        assert payload is not None
        self.assertEqual(payload["chat_type"], "bot")

    def test_new_message_user_is_pv(self):
        payload = map_new_message_event(
            account_id="acc",
            event=self._event(),
            title="علی",
            me_id=1,
            username="ali",
        )
        assert payload is not None
        self.assertEqual(payload["chat_type"], "pv")

    def test_new_message_bot_username_is_bot(self):
        payload = map_new_message_event(
            account_id="acc",
            event=self._event(),
            title="@digikala_bot",
            me_id=1,
            username="Digikala_Bot",
        )
        assert payload is not None
        self.assertEqual(payload["chat_type"], "bot")
        self.assertEqual(payload["external_chat_id"], "bale:user:381966434")

    def test_history_message_bot_username_is_bot(self):
        payload = map_history_message(
            account_id="acc",
            peer_type=1,
            peer_id=381966434,
            title="",
            entry=self._entry(),
            me_id=1,
            username="shop_bot",
        )
        assert payload is not None
        self.assertEqual(payload["chat_type"], "bot")

    def test_history_message_title_handle_only_is_bot(self):
        payload = map_history_message(
            account_id="acc",
            peer_type=1,
            peer_id=381966434,
            title="@post_bot",
            entry=self._entry(),
            me_id=1,
            username="",
        )
        assert payload is not None
        self.assertEqual(payload["chat_type"], "bot")

    def test_history_message_official_bale_is_bot(self):
        payload = map_history_message(
            account_id="acc",
            peer_type=1,
            peer_id=381966434,
            title="بله",
            entry=self._entry(),
            me_id=1,
            username="bale",
        )
        assert payload is not None
        self.assertEqual(payload["chat_type"], "bot")

    def test_history_message_group_stays_group(self):
        payload = map_history_message(
            account_id="acc",
            peer_type=2,
            peer_id=99,
            title="گروه فروش",
            entry=self._entry(),
            me_id=1,
            username="shop_bot",
        )
        assert payload is not None
        self.assertEqual(payload["chat_type"], "group")



if __name__ == "__main__":
    unittest.main()
