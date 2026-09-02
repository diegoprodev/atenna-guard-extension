import logging
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)
_bearer = HTTPBearer()


async def require_super_admin(
    request: Request,
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    token = creds.credentials
    if token.count(".") == 2:
        raise HTTPException(
            status_code=401,
            detail="Raw JWT not accepted. Use POST /auth/admin-login.",
        )
    try:
        from routes.bff_auth import resolve_token
        session = resolve_token(token)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("require_super_admin resolve failed: %s", e)
        raise HTTPException(401, "Falha na autenticacao.")
    if session.get("role") != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso restrito a administradores.")
    logger.info("[ADMIN] %s accessed %s", session.get("email", "?"), request.url.path)
    return session
