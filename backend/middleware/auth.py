"""
Server-side auth middleware — opaque BFF tokens only.
Raw Supabase JWTs are rejected; clients must authenticate via POST /auth/login.
"""
import logging
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

try:
    from observability_metrics import record_auth_failure
except Exception:  # pragma: no cover
    def record_auth_failure(*_a, **_k):
        return None

logger = logging.getLogger(__name__)
_bearer = HTTPBearer()


def require_auth(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    token = creds.credentials

    # Reject raw JWTs — only opaque BFF tokens accepted
    # A JWT has exactly 2 dots separating 3 base64url segments
    if token.count(".") == 2:
        record_auth_failure("raw_jwt")
        raise HTTPException(
            status_code=401,
            detail="Raw JWT not accepted — authenticate via POST /auth/login",
        )

    # Validate opaque token against BFF session store
    try:
        from routes.bff_auth import resolve_token
        session = resolve_token(token)
        try:
            import observability
            observability.set_request_user(session["user_id"], session.get("email"), session.get("plan"))
        except Exception:
            pass
        return {
            "user_id": session["user_id"],
            "email":   session["email"],
            "plan":    session["plan"],
        }
    except HTTPException:
        record_auth_failure("no_session")
        raise
    except Exception as e:
        record_auth_failure("error")
        logger.warning("require_auth failed: %s", e)
        raise HTTPException(401, "Authentication failed")
