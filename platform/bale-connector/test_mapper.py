"""Stable Bale peer/message identifiers."""

from __future__ import annotations

import unittest
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mapper import (  # noqa: E402
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



if __name__ == "__main__":
    unittest.main()
