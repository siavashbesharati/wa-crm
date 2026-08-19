from __future__ import annotations

from typing import Any

import httpx

from config import API_URL, CONNECTOR_KEY


class BidarApi:
    def __init__(self) -> None:
        self.client = httpx.Client(
            base_url=API_URL,
            headers={"X-Connector-Key": CONNECTOR_KEY},
            timeout=30,
        )

    def close(self) -> None:
        self.client.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.client.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()

    def sessions(self) -> list[dict[str, Any]]:
        return self._request("GET", "/internal/instagram/sessions")

    def auth(self, account_id: str) -> dict[str, Any]:
        return self._request("GET", f"/internal/instagram/sessions/{account_id}/auth")

    def settings(self, account_id: str) -> dict[str, Any]:
        return self._request("GET", f"/internal/instagram/sessions/{account_id}/settings")

    def state(self, account_id: str, **payload: Any) -> Any:
        return self._request("PUT", f"/internal/instagram/sessions/{account_id}/state", json=payload)

    def heartbeat(self, account_id: str) -> Any:
        return self._request("POST", f"/internal/instagram/sessions/{account_id}/heartbeat")

    def event(self, account_id: str, payload: dict[str, Any]) -> Any:
        return self._request("POST", f"/internal/instagram/sessions/{account_id}/events", json=payload)

    def claim_jobs(self, account_id: str, limit: int = 5) -> list[dict[str, Any]]:
        data = self._request(
            "POST",
            "/internal/instagram/jobs/claim",
            params={"account_id": account_id, "limit": limit},
        )
        return list((data or {}).get("jobs") or [])

    def complete_job(self, job_id: str, *, ok: bool = True, error: str = "") -> Any:
        return self._request(
            "POST",
            f"/internal/instagram/jobs/{job_id}/complete",
            params={"ok": str(ok).lower(), "error": error[:1000]},
        )
