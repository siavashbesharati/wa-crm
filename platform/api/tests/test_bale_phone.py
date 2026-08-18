"""Phone normalization for Bale auth — no network, no tokens."""

from __future__ import annotations

import unittest

from app.services.bale_auth import BaleAuthError, format_phone_display, normalize_iranian_phone


class TestNormalizeIranianPhone(unittest.TestCase):
    def test_plus_98(self):
        self.assertEqual(normalize_iranian_phone("+989121234567"), 989121234567)

    def test_00_prefix(self):
        self.assertEqual(normalize_iranian_phone("00989121234567"), 989121234567)

    def test_local_zero(self):
        self.assertEqual(normalize_iranian_phone("09121234567"), 989121234567)

    def test_bare_98(self):
        self.assertEqual(normalize_iranian_phone("989121234567"), 989121234567)

    def test_persian_digits(self):
        self.assertEqual(normalize_iranian_phone("۰۹۱۲۱۲۳۴۵۶۷"), 989121234567)

    def test_arabic_digits(self):
        self.assertEqual(normalize_iranian_phone("٠٩١٢١٢٣٤٥٦٧"), 989121234567)

    def test_spaces_and_dashes(self):
        self.assertEqual(normalize_iranian_phone("+98 912-123-4567"), 989121234567)

    def test_invalid(self):
        with self.assertRaises(BaleAuthError):
            normalize_iranian_phone("123")

    def test_display(self):
        self.assertEqual(format_phone_display(989121234567), "09121234567")


if __name__ == "__main__":
    unittest.main()
