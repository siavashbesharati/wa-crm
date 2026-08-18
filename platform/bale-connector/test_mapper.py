"""Stable Bale peer/message identifiers."""

from __future__ import annotations

import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mapper import message_external_id, parse_peer_key, peer_key  # noqa: E402


class TestPeerKeys(unittest.TestCase):
    def test_user_key(self):
        self.assertEqual(peer_key(1, 381966434), "bale:user:381966434")

    def test_group_key(self):
        self.assertEqual(peer_key(2, 99), "bale:group:99")

    def test_parse(self):
        self.assertEqual(parse_peer_key("bale:user:381966434"), ("user", 381966434))
        self.assertEqual(parse_peer_key("bale:group:10"), ("group", 10))

    def test_message_id(self):
        self.assertEqual(message_external_id(1, 381966434, 55), "bale:1:381966434:55")


if __name__ == "__main__":
    unittest.main()
