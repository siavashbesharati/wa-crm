"""Bale identity must not be rewritten as WhatsApp JIDs."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.services.bale_identity import (
    bale_lookup_ids,
    heal_bale_lead,
    is_bale_channel,
    reconstruct_bale_key,
)
from app.services.lead_identity import prefer_pn_external
from app.services.wa_jid import resolve_target_jid


def _lead(**kwargs):
    defaults = dict(
        source_channel="bale",
        chat_type="pv",
        external_chat_id="",
        phone="",
        name="",
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


class TestBaleIdentity(unittest.TestCase):
    def test_prefer_pn_keeps_bale_key(self):
        self.assertEqual(
            prefer_pn_external("381966434", "bale:user:381966434", None),
            "bale:user:381966434",
        )

    def test_prefer_pn_still_builds_wa_jid(self):
        self.assertEqual(
            prefer_pn_external("09121234567", None, None),
            "09121234567@s.whatsapp.net",
        )

    def test_reconstruct_from_misstag(self):
        self.assertEqual(
            reconstruct_bale_key("381966434@s.whatsapp.net"),
            "bale:user:381966434",
        )
        self.assertEqual(reconstruct_bale_key("bale:user:381966434"), "bale:user:381966434")

    def test_is_bale_channel_does_not_steal_whatsapp(self):
        self.assertFalse(is_bale_channel("whatsapp", "989121234567@s.whatsapp.net"))
        self.assertTrue(is_bale_channel("bale", "381966434@s.whatsapp.net"))
        self.assertTrue(is_bale_channel("", "bale:user:1"))

    def test_heal_misstagged_lead(self):
        lead = _lead(
            external_chat_id="381966434@s.whatsapp.net",
            phone="381966434",
            name="bale:user:381966434",
        )
        self.assertTrue(heal_bale_lead(lead))
        self.assertEqual(lead.external_chat_id, "bale:user:381966434")
        self.assertEqual(lead.phone, "")

    def test_heal_keeps_real_mobile(self):
        lead = _lead(
            external_chat_id="bale:user:381966434",
            phone="09121234567",
            name="علی",
        )
        changed = heal_bale_lead(lead)
        self.assertEqual(lead.phone, "09121234567")
        self.assertEqual(lead.name, "علی")
        self.assertFalse(changed)

    def test_resolve_target_jid_bale(self):
        lead = _lead(
            external_chat_id="381966434@s.whatsapp.net",
            phone="381966434",
        )
        self.assertEqual(resolve_target_jid(lead, None), "bale:user:381966434")

    def test_lookup_ids_include_legacy(self):
        ids = bale_lookup_ids("bale:user:381966434")
        self.assertIn("bale:user:381966434", ids)
        self.assertIn("381966434@s.whatsapp.net", ids)


if __name__ == "__main__":
    unittest.main()
