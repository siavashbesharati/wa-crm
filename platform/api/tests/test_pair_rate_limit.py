"""Unit tests for the per-phone, per-channel pairing rate limit."""

from __future__ import annotations

import unittest

from app.services.pair_rate_limit import (
    DEFAULT_WINDOW_SEC,
    check_and_record,
    humanize_wait,
    remaining_sec,
    reset_for_tests,
)


class TestPairRateLimit(unittest.TestCase):
    def setUp(self) -> None:
        reset_for_tests()

    def tearDown(self) -> None:
        reset_for_tests()

    def test_first_call_allowed(self) -> None:
        ok, retry = check_and_record("bale", "989121234567", now=1000.0)
        self.assertTrue(ok)
        self.assertEqual(retry, 0)

    def test_second_call_within_window_blocked(self) -> None:
        check_and_record("bale", "989121234567", now=1000.0)
        ok, retry = check_and_record("bale", "989121234567", now=1000.0 + 30)
        self.assertFalse(ok)
        self.assertEqual(retry, DEFAULT_WINDOW_SEC - 30)

    def test_call_after_window_allowed_again(self) -> None:
        check_and_record("bale", "989121234567", now=1000.0)
        ok, retry = check_and_record("bale", "989121234567", now=1000.0 + DEFAULT_WINDOW_SEC + 1)
        self.assertTrue(ok)
        self.assertEqual(retry, 0)

    def test_different_phones_have_separate_buckets(self) -> None:
        check_and_record("bale", "989121234567", now=1000.0)
        ok, _ = check_and_record("bale", "989128765432", now=1000.0 + 5)
        self.assertTrue(ok)

    def test_same_phone_different_channels_separate(self) -> None:
        check_and_record("bale", "989121234567", now=1000.0)
        ok, _ = check_and_record("whatsapp", "989121234567", now=1000.0 + 5)
        self.assertTrue(ok)
        ok, _ = check_and_record("divar", "989121234567", now=1000.0 + 5)
        self.assertTrue(ok)

    def test_remaining_sec(self) -> None:
        self.assertEqual(remaining_sec("bale", "989121234567", now=1000.0), 0)
        check_and_record("bale", "989121234567", now=1000.0)
        self.assertEqual(
            remaining_sec("bale", "989121234567", now=1000.0 + 60),
            DEFAULT_WINDOW_SEC - 60,
        )
        self.assertEqual(
            remaining_sec("bale", "989121234567", now=1000.0 + DEFAULT_WINDOW_SEC + 5),
            0,
        )

    def test_empty_phone_does_not_block(self) -> None:
        # Missing phone means the rate limiter can't key the bucket, so
        # requests should fall through and let downstream validation handle it.
        ok, retry = check_and_record("bale", "", now=1000.0)
        self.assertTrue(ok)
        self.assertEqual(retry, 0)

    def test_retry_after_always_at_least_one_second(self) -> None:
        check_and_record("bale", "989121234567", now=1000.0)
        # Just barely inside the window
        ok, retry = check_and_record("bale", "989121234567", now=1000.0 + DEFAULT_WINDOW_SEC - 0.1)
        self.assertFalse(ok)
        # 0.1s remaining — must round up to 1, not down to 0
        self.assertGreaterEqual(retry, 1)

    def test_humanize_wait_persian(self) -> None:
        # 30s -> "۳۰ ثانیه"
        self.assertEqual(humanize_wait(30), "۳۰ ثانیه")
        # 60s -> "۱ دقیقه"
        self.assertEqual(humanize_wait(60), "۱ دقیقه")
        # 120s -> "۲ دقیقه"
        self.assertEqual(humanize_wait(120), "۲ دقیقه")
        # 65s -> "۱ دقیقه و ۵ ثانیه"
        self.assertEqual(humanize_wait(65), "۱ دقیقه و ۵ ثانیه")
        # Default 5-minute window
        self.assertEqual(humanize_wait(300), "۵ دقیقه")


if __name__ == "__main__":
    unittest.main()
