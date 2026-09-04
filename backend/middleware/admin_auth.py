import logging
import os
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)
_bearer = HTTPBearer()


def _admin_emails() -> set[str]:
    return {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "devdiegopro@gmail.com").split(",") if e.strip()}


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
        from services.session_store import resolve_token
        session = resolve_token(token)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("require_super_admin resolve failed: %s", e)
        raise HTTPException(401, "Falha na autenticacao.")
    # Zero-trust: revalida o gate de admin a CADA request /admin/*, não confia
    # só no que foi decidido no login. Aceita role explícita (se a coluna existir)
    # OU o e-mail da sessão na allowlist ADMIN_EMAILS.
    email = (session.get("email") or "").lower()
    if session.get("role") != "super_admin" and email not in _admin_emails():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso restrito a administradores.")
    session.setdefault("id", session.get("user_id"))
    logger.info("[ADMIN] %s accessed %s", session.get("email", "?"), request.url.path)
    return session
