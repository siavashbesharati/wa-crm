"""Windows consoles default to cp1252; Persian in print() aborts the request."""

from __future__ import annotations

import sys


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def safe_print(*args: object, **kwargs: object) -> None:
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        text = " ".join(str(a) for a in args)
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        try:
            sys.stdout.buffer.write((text + "\n").encode(enc, errors="replace"))
        except Exception:
            pass


configure_stdio()
