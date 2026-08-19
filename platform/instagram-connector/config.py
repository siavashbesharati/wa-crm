from __future__ import annotations

import os

API_URL = os.getenv("BIDAR_API_URL", "http://localhost:8000/api").rstrip("/")
CONNECTOR_KEY = os.getenv("INSTAGRAM_CONNECTOR_KEY", "")
POLL_SECONDS = max(30, int(os.getenv("INSTAGRAM_POLL_SECONDS", "60")))
THREAD_LIMIT = max(1, min(50, int(os.getenv("INSTAGRAM_THREAD_LIMIT", "20"))))
MESSAGE_LIMIT = max(1, min(50, int(os.getenv("INSTAGRAM_MESSAGE_LIMIT", "20"))))
MEDIA_LIMIT = max(1, min(30, int(os.getenv("INSTAGRAM_MEDIA_LIMIT", "20"))))
COMMENT_LIMIT = max(1, min(50, int(os.getenv("INSTAGRAM_COMMENT_LIMIT", "20"))))
