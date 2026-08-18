from __future__ import annotations

from typing import Any

import requests

from config import API_BASE, CONNECTOR_KEY


class ApiClient:
    def __init__(self) -> None:
        self._s = requests.Session()
        self._s.headers.update(
            {
                "X-Connector-Key": CONNECTOR_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

    def _url(self, path: str) -> str:
        return f"{API_BASE}{path}"

    def list_sessions(self) -> list[dict[str, Any]]:
        r = self._s.get(self._url("/internal/bale/sessions"), timeout=20)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else []

    def get_auth(self, account_id: str) -> dict[str, Any]:
        r = self._s.get(self._url(f"/internal/bale/sessions/{account_id}/auth"), timeout=20)
        r.raise_for_status()
        return r.json()

    def put_cursors(self, account_id: str, cursors: dict[str, Any]) -> None:
        r = self._s.put(
            self._url(f"/internal/bale/sessions/{account_id}/cursors"),
            json=cursors,
            timeout=20,
        )
        r.raise_for_status()

    def put_pair_state(
        self,
        account_id: str,
        *,
        pairing_state: str = "",
        status: str = "",
        external_id: str = "",
        label: str = "",
    ) -> None:
        r = self._s.put(
            self._url(f"/internal/bale/sessions/{account_id}/pair-state"),
            params={
                "pairing_state": pairing_state,
                "status": status,
                "external_id": external_id,
                "label": label,
            },
            timeout=20,
        )
        r.raise_for_status()

    def heartbeat(self, account_id: str) -> None:
        r = self._s.post(self._url(f"/internal/bale/sessions/{account_id}/heartbeat"), timeout=15)
        r.raise_for_status()

    def ingest(self, account_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        r = self._s.post(
            self._url(f"/internal/bale/sessions/{account_id}/ingest"),
            json=payload,
            timeout=45,
        )
        r.raise_for_status()
        return r.json()

    def claim_jobs(self, account_id: str, limit: int = 5) -> list[dict[str, Any]]:
        r = self._s.post(
            self._url("/internal/bale/jobs/claim"),
            params={"account_id": account_id, "limit": limit},
            timeout=20,
        )
        r.raise_for_status()
        return list((r.json() or {}).get("jobs") or [])

    def complete_job(self, job_id: str, *, ok: bool = True, error: str = "") -> None:
        r = self._s.post(
            self._url(f"/internal/bale/jobs/{job_id}/complete"),
            params={"ok": str(ok).lower(), "error": error or ""},
            timeout=20,
        )
        r.raise_for_status()


api = ApiClient()
