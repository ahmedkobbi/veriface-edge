"""
VeriFace Edge SDK — Client

Server-side client for:
  - Session initialization (POST /api/session/init)
  - Token verification (POST /api/token/verify)
  - Token revocation (POST /api/token/revoke)
  - Audit log queries (GET /api/audit)
"""

import httpx
from typing import Optional, Any
from .types import (
    VeriFaceConfig,
    SessionInitResponse,
    SessionVerifyResponse,
    TokenVerifyResult,
    VeriFaceError,
)


class VeriFaceClient:
    """VeriFace Edge API client."""

    def __init__(
        self,
        tenant_id: str,
        api_key: str,
        api_base_url: str = "https://api.veriface.io",
        timeout: float = 10.0,
    ):
        self.config = VeriFaceConfig(
            tenantId=tenant_id,
            apiKey=api_key,
            apiBaseUrl=api_base_url,
            timeout=timeout,
        )
        self._client = httpx.Client(
            base_url=api_base_url,
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    def init_session(
        self,
        flow: str = "authenticate",
        external_user_id: Optional[str] = None,
    ) -> SessionInitResponse:
        """Initialize a new authentication session."""
        payload: dict[str, Any] = {
            "tenantId": self.config.tenant_id,
            "flow": flow,
        }
        if external_user_id:
            payload["externalUserId"] = external_user_id

        res = self._client.post("/api/session/init", json=payload)
        data = res.json()

        if not data.get("success"):
            raise VeriFaceError(
                data.get("error", "Session init failed"),
                data.get("code", "INIT_FAILED"),
            )

        return SessionInitResponse(**data)

    def verify_token(self, token: str) -> TokenVerifyResult:
        """Verify a VeriFace auth token (for server-side auth checks)."""
        res = self._client.post(
            "/api/token/verify",
            json={"token": token, "tenantId": self.config.tenant_id},
        )
        data = res.json()

        return TokenVerifyResult(
            valid=data.get("valid", False),
            tenantId=data.get("tenantId"),
            externalUserId=data.get("externalUserId"),
            sessionId=data.get("sessionId"),
            flow=data.get("flow"),
            expiresAt=data.get("expiresAt"),
            livenessScore=data.get("livenessScore"),
        )

    def revoke_token(self, token: str, reason: str = "user_logout") -> bool:
        """Revoke a token before its expiry."""
        res = self._client.post(
            "/api/token/revoke",
            json={
                "token": token,
                "tenantId": self.config.tenant_id,
                "reason": reason,
            },
        )
        data = res.json()
        return data.get("success", False)

    def get_audit_log(
        self,
        limit: int = 50,
        cursor: Optional[str] = None,
        event_type: Optional[str] = None,
    ) -> dict:
        """Query the audit log."""
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        if event_type:
            params["eventType"] = event_type

        res = self._client.get("/api/audit", params=params)
        return res.json()

    def verify_api_key(self) -> bool:
        """Verify the API key is valid + active."""
        try:
            res = self._client.get("/api/health")
            return res.status_code == 200
        except Exception:
            return False

    def close(self):
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
