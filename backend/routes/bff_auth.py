"""
BFF Auth Service — opaque token layer over Supabase JWTs.

IMPORTANT — Single-worker constraint:
  _sessions is an in-memory dict. This is intentional for our single-VPS deployment.
  The uvicorn/gunicorn process MUST be started with --workers 1 (see docker-compose.yml).
  If you ever need multiple workers, replace _sessions with Redis or a Supabase table.
"""
import os
import uuid
import time
import logging
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from services.supabase_admin import get_admin_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["BFF Auth"])
_bearer = HTTPBearer()

# In-memory session store — single-worker only (see module docstring).
_sessions: dict[str, dict] = {}
_TOKEN_TTL = 3600

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
    opaque = str(uuid.uuid4())
    expires_at = int(time.time()) + _TOKEN_TTL
    _sessions[opaque] = {
        "supabase_jwt": supabase_jwt,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "user_id": user_id,
        "email": email,
        "plan": plan,
    }
    return {"token": opaque, "expires_at": expires_at, "plan": plan}

def resolve_token(opaque: str) -> dict:
    session = _sessions.get(opaque)
    if not session:
        raise HTTPException(401, "Invalid or expired token")
    if session["expires_at"] < int(time.time()):
        del _sessions[opaque]
        raise HTTPException(401, "Token expired")
    return session

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
    del _sessions[req.token]
    return _issue_token(new_jwt, new_refresh, session["user_id"], session["email"], session["plan"])

@router.post("/logout")
async def logout(req: LogoutRequest):
    _sessions.pop(req.token, None)
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
    return {
        "user_id": session["user_id"],
        "email": session["email"],
        "plan": session["plan"],
        "expires_at": session["expires_at"],
    }

@router.post("/reset-password")
async def reset_password(req: ResetRequest):
    try:
        get_admin_client().auth.reset_password_email(req.email)
    except Exception:
        pass
    return {"ok": True}
