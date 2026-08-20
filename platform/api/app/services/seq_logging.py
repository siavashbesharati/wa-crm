"""Optional Seq sink for all Python logging records."""

from __future__ import annotations

import logging
import os
from typing import Any

_SEQ_HANDLER_MARKER = "_miogen_seq_handler"


def configure_seq_logging(service: str) -> None:
    """Send Python logs to Seq while leaving existing console handlers intact."""
    if os.getenv("SEQ_ENABLED", "1").strip().lower() in {"0", "false", "no", "off"}:
        return

    root = logging.getLogger()
    if any(getattr(handler, _SEQ_HANDLER_MARKER, False) for handler in root.handlers):
        return

    try:
        import seqlog
    except ImportError:
        logging.getLogger(__name__).warning("seqlog is not installed; Seq logging disabled")
        return

    seqlog.configure_feature(seqlog.FeatureFlag.IGNORE_SEQ_SUBMISSION_ERRORS, True)
    seqlog.configure_feature(seqlog.FeatureFlag.EXTRA_PROPERTIES, True)
    server_url = os.getenv("SEQ_URL", "http://localhost:5341").strip().rstrip("/")
    api_key = os.getenv("SEQ_API_KEY", "").strip() or None
    handler = seqlog.SeqLogHandler(
        server_url=server_url,
        api_key=api_key,
        batch_size=10,
        auto_flush_timeout=2,
    )
    setattr(handler, _SEQ_HANDLER_MARKER, True)
    handler.setLevel(logging.INFO)
    handler.addFilter(_ServiceFilter(service))
    root.addHandler(handler)
    for logger_name in ("uvicorn.access", "uvicorn.error"):
        logging.getLogger(logger_name).addHandler(handler)


class _ServiceFilter(logging.Filter):
    def __init__(self, service: str) -> None:
        super().__init__()
        self.service = service

    def filter(self, record: logging.LogRecord) -> bool:
        if getattr(record, "_seq_sent", False):
            return False
        record._seq_sent = True
        record.service = self.service
        return True


def log_to_seq(logger: logging.Logger, message: str, *, service: str, **fields: Any) -> None:
    """Write a structured event through the normal logging pipeline."""
    logger.info(message, extra={"service": service, **fields})
