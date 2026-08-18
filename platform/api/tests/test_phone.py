"""Shared phone normalization — no network."""

from __future__ import annotations

import unittest

from app.services.phone import (
    normalize_ir_mobile,
    normalize_phone_for_storage,
    phone_aliases,
    to_cc_digits,
    try_normalize_ir_mobile,
)


class TestPhoneNormalize(unittest.TestCase):
    def test_local_zero(self):
        self.assertEqual(normalize_ir_mobile("09121234567"), "09121234567")

    def test_plus_98(self):
        self.assertEqual(normalize_phone_for_storage("+989121234567"), "09121234567")

    def test_bare_98(self):
        self.assertEqual(normalize_phone_for_storage("989121234567"), "09121234567")

    def test_persian_digits(self):
        self.assertEqual(normalize_phone_for_storage("۰۹۱۲۱۲۳۴۵۶۷"), "09121234567")

    def test_spaces(self):
        self.assertEqual(normalize_phone_for_storage("+98 912-123-4567"), "09121234567")

    def test_cc_digits(self):
        self.assertEqual(to_cc_digits("09121234567"), "989121234567")
        self.assertEqual(to_cc_digits("+989121234567"), "989121234567")

    def test_invalid_ir(self):
        self.assertIsNone(try_normalize_ir_mobile("123"))
        with self.assertRaises(ValueError):
            normalize_ir_mobile("123")

    def test_aliases_include_old_forms(self):
        aliases = phone_aliases("09121234567")
        self.assertIn("09121234567", aliases)
        self.assertIn("989121234567", aliases)
        self.assertIn("+989121234567", aliases)


if __name__ == "__main__":
    unittest.main()
