"""
VeriFace Edge SDK for Python
============================

Privacy-first facial authentication. Server-side auth verification + token introspection.

Usage:
    from veriface_edge import VeriFaceClient

    client = VeriFaceClient(
        tenant_id="tnt_...",
        api_key="vf_live_...",
        api_base_url="https://api.veriface.io",
    )

    # Initialize session
    session = client.init_session(flow="authenticate", external_user_id="user_123")

    # Verify token (from client SDK)
    result = client.verify_token(token=session.token)
    print(f"Valid: {result.valid}")
"""

from .client import VeriFaceClient
from .types import (
    VeriFaceConfig,
    SessionInitResponse,
    SessionVerifyResponse,
    TokenVerifyResult,
    VeriFaceError,
)

__version__ = "1.0.0"
__all__ = [
    "VeriFaceClient",
    "VeriFaceConfig",
    "SessionInitResponse",
    "SessionVerifyResponse",
    "TokenVerifyResult",
    "VeriFaceError",
]
