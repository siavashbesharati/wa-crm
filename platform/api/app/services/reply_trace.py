"""Timestamped logging for inbound message → AI reply pipeline."""

from __future__ import annotations

import time
import logging
from datetime import datetime, timezone

from app.services.stdio_utf8 import safe_print

_traces: dict[str, float] = {}
_job_traces: dict[str, str] = {}
_trace_log: dict[str, list[dict]] = {}
_MAX_EVENTS_PER_TRACE = 80
_MAX_TRACES = 300
_logger = logging.getLogger("reply-trace")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]


def _prune_traces() -> None:
    if len(_trace_log) <= _MAX_TRACES:
        return
    keys = sorted(_trace_log.keys(), key=lambda k: _traces.get(k, 0))
    for key in keys[: len(keys) - _MAX_TRACES + 20]:
        _trace_log.pop(key, None)
        _traces.pop(key, None)


def trace_event(trace_id: str | None, stage: str, **fields: object) -> None:
    tid = (trace_id or "").strip()
    now = time.time()
    elapsed_ms = 0
    if tid:
        if tid not in _traces:
            _traces[tid] = now
        elapsed_ms = int((now - _traces[tid]) * 1000)
    extra = " ".join(
        f"{key}={value}"
        for key, value in fields.items()
        if value is not None and str(value) != ""
    )
    suffix = f" {extra}" if extra else ""
    message = f"[reply-trace] {_now_iso()} +{elapsed_ms}ms {tid or '-'} {stage}{suffix}"
    safe_print(message)
    _logger.info(
        message,
        extra={
            "service": "api",
            "trace_id": tid or "-",
            "stage": stage,
            "elapsed_ms": elapsed_ms,
            **{key: value for key, value in fields.items() if value is not None and str(value) != ""},
        },
    )
    if tid:
        log = _trace_log.setdefault(tid, [])
        log.append(
            {
                "t": _now_iso(),
                "elapsed_ms": elapsed_ms,
                "stage": stage,
                "fields": {k: v for k, v in fields.items() if v is not None and str(v) != ""},
            }
        )
        if len(log) > _MAX_EVENTS_PER_TRACE:
            del log[: len(log) - _MAX_EVENTS_PER_TRACE]
        _prune_traces()


def get_trace_events(trace_id: str | None, since: int = 0) -> list[dict]:
    tid = (trace_id or "").strip()
    if not tid:
        return []
    events = _trace_log.get(tid, [])
    idx = max(0, int(since or 0))
    return events[idx:]


def link_job_trace(job_id: str, trace_id: str | None) -> None:
    jid = (job_id or "").strip()
    tid = (trace_id or "").strip()
    if jid and tid:
        _job_traces[jid] = tid


def job_trace_id(job_id: str) -> str:
    return _job_traces.get((job_id or "").strip(), "")


def finish_trace(trace_id: str | None, stage: str = "pipeline_done", **fields: object) -> None:
    trace_event(trace_id, stage, **fields)
    tid = (trace_id or "").strip()
    if tid:
        _traces.pop(tid, None)
