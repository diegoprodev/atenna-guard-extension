"""
Armazenamento das sessões BFF (token opaco → sessão).

Extraído de `routes/bff_auth.py` (FASE P3.3) para o `middleware/` poder resolver
token sem importar `routes/` (inversão de camada).

Persiste em Supabase `bff_sessions`; se a tabela não existir, cai para in-memory
(reinício = logout) e o gauge `atenna_bff_session_store` vai a 0.
"""
import logging
import time
import uuid

from fastapi import HTTPException

import services.supabase_admin as _supabase_admin


def get_admin_client():
    # via módulo p/ os testes conseguirem mockar em services.supabase_admin
    return _supabase_admin.get_admin_client()

try:
    from security.monitor import log_security_event
except Exception:  # pragma: no cover
    def log_security_event(*a, **kw):
        return None

try:
    from observability_metrics import set_bff_session_store
except Exception:  # pragma: no cover
    def set_bff_session_store(*a, **kw):
        return None

logger = logging.getLogger(__name__)

TOKEN_TTL = 3600

# Fallback in-memory (usado quando a tabela bff_sessions ainda não existe)
_sessions_fallback: dict[str, dict] = {}
_table_ok: bool | None = None  # None = não checado, True = ok, False = ausente


def reset_for_tests() -> None:
    """Zera o estado de módulo entre testes (chamado pelo conftest)."""
    global _table_ok
    _table_ok = None
    _sessions_fallback.clear()


def _check_table() -> bool:
    global _table_ok
    if _table_ok is not None:
        return _table_ok
    try:
        get_admin_client().table('bff_sessions').select('token').limit(0).execute()
        _table_ok = True
        logger.info("bff_sessions table verified ✓")
    except Exception:
        _table_ok = False
        logger.warning("bff_sessions table not found — using in-memory fallback. "
                       "Run the migration SQL in Supabase dashboard to enable persistent sessions.")
        log_security_event("bff_sessions_fallback", {"reason": "table_missing"}, severity="CRITICAL")
    set_bff_session_store(_table_ok)
    return _table_ok


def issue_token(supabase_jwt: str, refresh_token: str, user_id: str, email: str, plan: str) -> dict:
    """Emite um token opaco novo. Persiste no Supabase se a tabela existir, senão in-memory."""
    opaque = str(uuid.uuid4())
    expires_at = int(time.time()) + TOKEN_TTL

    if _check_table():
        try:
            get_admin_client().table('bff_sessions').insert({
                'token': opaque,
                'supabase_jwt': supabase_jwt,
                'refresh_token': refresh_token,
                'user_id': user_id,
                'email': email,
                'plan': plan,
                'expires_at': expires_at,
            }).execute()
        except Exception as e:
            logger.error(f"Failed to persist token: {e}")
            raise HTTPException(500, "Failed to create session")
    else:
        _sessions_fallback[opaque] = {
            'user_id': user_id, 'email': email, 'plan': plan,
            'expires_at': expires_at, 'supabase_jwt': supabase_jwt,
        }

    return {"token": opaque, "expires_at": expires_at, "plan": plan}


def resolve_token(opaque: str) -> dict:
    """Resolve token. Checa Supabase se a tabela existir, senão o fallback in-memory."""
    if not _check_table():
        session = _sessions_fallback.get(opaque)
        if not session:
            raise HTTPException(401, "Invalid or expired token")
        if session['expires_at'] < int(time.time()):
            _sessions_fallback.pop(opaque, None)
            raise HTTPException(401, "Token expired")
        return session

    try:
        client = get_admin_client()
        resp = client.table('bff_sessions').select('*').eq('token', opaque).single().execute()

        if not resp.data:
            raise HTTPException(401, "Invalid or expired token")

        session = resp.data
        now = int(time.time())

        if session['expires_at'] < now:
            try:
                client.table('bff_sessions').delete().eq('token', opaque).execute()
            except Exception:
                pass
            raise HTTPException(401, "Token expired")

        return session
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to resolve token: {e}")
        raise HTTPException(401, "Invalid or expired token")
