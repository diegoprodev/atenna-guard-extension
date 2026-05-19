"""
Server-side auth middleware — opaque BFF tokens only.
Raw Supabase JWTs are rejected; clients must authenticate via POST /auth/login.
"""
import logging
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)
_bearer = HTTPBearer()


def require_auth(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    token = creds.credentials

    # Reject raw JWTs — only opaque BFF tokens accepted
    # A JWT has exactly 2 dots separating 3 base64url segments
    if token.count(".") == 2:
        raise HTTPException(
            status_code=401,
            detail="Raw JWT not accepted — authenticate via POST /auth/login",
        )

    # Validate opaque token against BFF session store
    try:
        from routes.bff_auth import resolve_token
        session = resolve_token(token)
        return {
            "user_id": session["user_id"],
            "email":   session["email"],
            "plan":    session["plan"],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("require_auth failed: %s", e)
        raise HTTPException(401, "Authentication failed")
