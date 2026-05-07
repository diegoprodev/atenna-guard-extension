"""
Server-side JWT validation via Supabase.
Every protected endpoint calls require_auth as a FastAPI Dependency.
"""
import os
import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

_security = HTTPBearer(auto_error=True)

SUPABASE_URL = os.getenv(
    "SUPABASE_URL",
    "https://kezbssjmgwtrunqeoyir.supabase.co",
)
SUPABASE_ANON_KEY = os.getenv(
    "SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzY0NzcsImV4cCI6MjA5MzUxMjQ3N30.c2YNPrG7WcbwtFij8UJlS7BNxY_XeaKoeqPlrKHloKs",
)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Token inválido, ausente ou expirado.",
    headers={"WWW-Authenticate": "Bearer"},
)


async def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> dict:
    """
    Validates the Bearer JWT against Supabase /auth/v1/user.
    Returns the user payload on success; raises 401 on failure.
    """
    token = credentials.credentials
    if not token:
        raise _UNAUTHORIZED

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey":        SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de autenticação indisponível. Tente novamente.",
        )

    if resp.status_code == 401 or resp.status_code == 403:
        raise _UNAUTHORIZED

    if not resp.is_success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Erro ao validar sessão.",
        )

    return resp.json()
