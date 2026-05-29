"""
BFF Auth Service — opaque token layer over Supabase JWTs.

Sessions are persisted in Supabase `bff_sessions` table.
This allows sessions to survive service restarts.

MIGRATION REQUIRED — run once in Supabase SQL editor:
  CREATE TABLE IF NOT EXISTS bff_sessions (
    token TEXT PRIMARY KEY,
    supabase_jwt TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    user_id UUID NOT NULL,
    email TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    role TEXT,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_bff_sessions_expires ON bff_sessions (expires_at);
  CREATE INDEX IF NOT EXISTS idx_bff_sessions_user_id ON bff_sessions (user_id);
  ALTER TABLE bff_sessions ENABLE ROW LEVEL SECURITY;

If the table doesn't exist, sessions fall back to in-memory (restart = logout).
"""
import os
import uuid
import time
import logging
from collections import deque
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from services.supabase_admin import get_admin_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["BFF Auth"])
_bearer = HTTPBearer()

TOKEN_TTL = 3600

# In-memory fallback used when bff_sessions table not yet created
_sessions_fallback: dict[str, dict] = {}
_table_ok: bool | None = None  # None = not checked, True = ok, False = missing

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
    return _table_ok

# Rate limiting for login endpoint — 5 attempts per email per minute
_login_attempts: dict[str, deque] = {}
LOGIN_WINDOW = 60  # seconds
LOGIN_MAX = 5

def _check_login_rate_limit(email: str) -> bool:
    """Check if email has exceeded login attempts. Return False if rate-limited."""
    now = time.monotonic()
    dq = _login_attempts.setdefault(email, deque())

    # Remove old attempts outside the window
    while dq and now - dq[0] > LOGIN_WINDOW:
        dq.popleft()

    # Check if we've hit the limit
    if len(dq) >= LOGIN_MAX:
        return False  # Rate limited

    # Record this attempt
    dq.append(now)
    return True  # Not rate limited

class LoginRequest(BaseModel):
    email: str
    password: str

class RefreshRequest(BaseModel):
    token: str

class LogoutRequest(BaseModel):
    token: str

class ResetRequest(BaseModel):
    email: str

def _issue_token(supabase_jwt: str, refresh_token: str, user_id: str, email: str, plan: str) -> dict:
    """Issue a new opaque BFF token. Persists to Supabase if table exists, else in-memory."""
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
        # Fallback: in-memory session (lost on restart)
        _sessions_fallback[opaque] = {
            'user_id': user_id, 'email': email, 'plan': plan,
            'expires_at': expires_at, 'supabase_jwt': supabase_jwt,
        }

    return {"token": opaque, "expires_at": expires_at, "plan": plan}

def resolve_token(opaque: str) -> dict:
    """Resolve token. Checks Supabase if table exists, else falls back to in-memory."""
    if not _check_table():
        # In-memory fallback
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

def _get_plan(user_id: str) -> str:
    try:
        client = get_admin_client()
        r = client.table("user_plans").select("plan_type").eq("user_id", user_id).single().execute()
        return r.data.get("plan_type", "free") if r.data else "free"
    except Exception as e:
        logger.warning(f"_get_plan failed: {e}")
        return "free"

@router.post("/login")
async def login(req: LoginRequest):
    # Rate limiting check — 5 attempts per email per minute
    if not _check_login_rate_limit(req.email):
        raise HTTPException(429, "Too many login attempts. Please try again later.")

    try:
        client = get_admin_client()
        r = client.auth.sign_in_with_password({"email": req.email, "password": req.password})
    except Exception:
        raise HTTPException(401, "Invalid credentials")
    if not r or not r.session:
        raise HTTPException(401, "Authentication failed")
    jwt = r.session.access_token
    refresh_tok = r.session.refresh_token
    uid = r.user.id
    email = r.user.email or req.email
    plan = _get_plan(uid)
    return _issue_token(jwt, refresh_tok, uid, email, plan)

@router.post("/refresh")
async def refresh(req: RefreshRequest):
    session = resolve_token(req.token)
    try:
        client = get_admin_client()
        r = client.auth.refresh_session(session["refresh_token"])
        new_jwt = r.session.access_token
        new_refresh = r.session.refresh_token
    except Exception:
        raise HTTPException(401, "Could not refresh session")
    # Delete old token
    try:
        client = get_admin_client()
        client.table('bff_sessions').delete().eq('token', req.token).execute()
    except Exception as e:
        logger.warning(f"Failed to delete old token: {e}")
    return _issue_token(new_jwt, new_refresh, session["user_id"], session["email"], session["plan"])

@router.post("/logout")
async def logout(req: LogoutRequest):
    try:
        client = get_admin_client()
        client.table('bff_sessions').delete().eq('token', req.token).execute()
    except Exception as e:
        logger.warning(f"Failed to logout token: {e}")
    return {"ok": True}

@router.get("/me")
async def me(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    token = creds.credentials
    # Reject raw JWTs — only opaque BFF tokens accepted
    if token.count(".") == 2:
        raise HTTPException(
            status_code=401,
            detail="Raw JWT not accepted — authenticate via POST /auth/login",
        )
    session = resolve_token(token)
    # Always re-fetch plan so upgrades/downgrades are reflected immediately.
    # _get_plan() is cheap (single SELECT) and prevents stale FREE display for PRO users.
    current_plan = _get_plan(session["user_id"])
    session["plan"] = current_plan
    return {
        "user_id": session["user_id"],
        "email": session["email"],
        "plan": current_plan,
        "expires_at": session["expires_at"],
    }

@router.post("/reset-password")
async def reset_password(req: ResetRequest):
    try:
        get_admin_client().auth.reset_password_email(req.email)
    except Exception:
        pass
    return {"ok": True}


# ---------------------------------------------------------------------------
# Scheduled cleanup — called from main.py scheduler daily at 3am
# ---------------------------------------------------------------------------

async def cleanup_old_dlp_events() -> dict:
    """Remove dlp_events older than 90 days. Called by APScheduler."""
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    try:
        client = get_admin_client()
        result = client.table('dlp_events').delete().lt('created_at', cutoff).execute()
        deleted = len(result.data) if result.data else 0
        logger.info(f'cleanup_old_dlp_events: deleted {deleted} rows older than 90 days')

        # Also cleanup expired bff_sessions if table exists
        if _check_table():
            now_ts = int(time.time())
            client.table('bff_sessions').delete().lt('expires_at', now_ts - 3600).execute()

        count_result = client.table('dlp_events').select('id', count='exact').execute()
        total = count_result.count or 0
        if total > 500_000:
            logger.warning(f'dlp_events has {total} rows — consider reducing TTL')

        return {'deleted': deleted, 'remaining': total}
    except Exception as e:
        logger.warning(f'cleanup_old_dlp_events failed: {e}')
        return {'deleted': 0, 'error': str(e)}
