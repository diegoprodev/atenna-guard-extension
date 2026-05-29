"""
BFF Auth Service — opaque token layer over Supabase JWTs.

Sessions are persisted in Supabase `bff_sessions` table.
This allows sessions to survive service restarts.
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
    """Issue a new opaque BFF token stored in Supabase."""
    opaque = str(uuid.uuid4())
    expires_at = int(time.time()) + TOKEN_TTL

    try:
        client = get_admin_client()
        client.table('bff_sessions').insert({
            'token': opaque,
            'supabase_jwt': supabase_jwt,
            'refresh_token': refresh_token,
            'user_id': user_id,
            'email': email,
            'plan': plan,
            'expires_at': expires_at,
        }).execute()
        return {"token": opaque, "expires_at": expires_at, "plan": plan}
    except Exception as e:
        logger.error(f"Failed to issue token: {e}")
        raise HTTPException(500, "Failed to create session")

def resolve_token(opaque: str) -> dict:
    """Resolve token from Supabase, delete if expired."""
    try:
        client = get_admin_client()
        resp = client.table('bff_sessions').select('*').eq('token', opaque).single().execute()

        if not resp.data:
            raise HTTPException(401, "Invalid or expired token")

        session = resp.data
        now = int(time.time())

        if session['expires_at'] < now:
            # Expired, delete it
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
