"""VeriFace Edge SDK — Type definitions."""

from pydantic import BaseModel, Field
from typing import Optional, Any
from enum import Enum


class VeriFaceConfig(BaseModel):
    """SDK configuration."""
    tenant_id: str = Field(..., alias="tenantId")
    api_key: str = Field(..., alias="apiKey")
    api_base_url: str = Field(default="https://api.veriface.io", alias="apiBaseUrl")
    timeout: float = Field(default=10.0)


class SessionInitResponse(BaseModel):
    """Response from POST /api/session/init."""
    success: bool
    session_id: str = Field(alias="sessionId")
    challenge: str
    backend_pub_key: str = Field(alias="backendPubKey")
    expires_at: str = Field(alias="expiresAt")
    experiment: Optional[Any] = None


class SessionVerifyResponse(BaseModel):
    """Response from POST /api/session/verify."""
    success: bool
    token: Optional[str] = None
    expires_at: Optional[int] = Field(default=None, alias="expiresAt")
    session_id: str = Field(alias="sessionId")
    flow: str
    error_code: Optional[str] = Field(default=None, alias="errorCode")
    error: Optional[str] = None


class TokenVerifyResult(BaseModel):
    """Result of token verification."""
    valid: bool
    tenant_id: Optional[str] = Field(default=None, alias="tenantId")
    external_user_id: Optional[str] = Field(default=None, alias="externalUserId")
    session_id: Optional[str] = Field(default=None, alias="sessionId")
    flow: Optional[str] = None
    expires_at: Optional[int] = Field(default=None, alias="expiresAt")
    liveness_score: Optional[float] = Field(default=None, alias="livenessScore")


class VeriFaceError(Exception):
    """VeriFace SDK error."""
    def __init__(self, message: str, code: str = "UNKNOWN"):
        self.message = message
        self.code = code
        super().__init__(f"[{code}] {message}")
