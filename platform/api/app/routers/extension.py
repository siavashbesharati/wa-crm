"""Public extension version endpoint — reads synced global version config."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/extension", tags=["extension"])

# Prefer API mirror written by sync script; fall back to repo-root config.
_MIRROR = Path(__file__).resolve().parents[1] / "extension_version.json"
_ROOT_CONFIG = Path(__file__).resolve().parents[4] / "config" / "extension.json"


def _load_meta() -> dict:
    for path in (_MIRROR, _ROOT_CONFIG):
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                version = str(data.get("version") or "").strip()
                if version:
                    file_name = str(data.get("file") or data.get("download_file") or "iranexpedia-extension.zip")
                    download_path = str(
                        data.get("download_path") or f"/downloads/{file_name}"
                    )
                    return {
                        "version": version,
                        "file": file_name,
                        "download_path": download_path,
                        "download_url": download_path,
                    }
            except (OSError, json.JSONDecodeError, TypeError):
                continue
    return {
        "version": "0.0.0",
        "file": "iranexpedia-extension.zip",
        "download_path": "/downloads/iranexpedia-extension.zip",
        "download_url": "/downloads/iranexpedia-extension.zip",
    }


@router.get("/latest")
def latest_extension():
    """Latest published Chrome extension version (no auth)."""
    meta = _load_meta()
    return {"ok": True, **meta}
