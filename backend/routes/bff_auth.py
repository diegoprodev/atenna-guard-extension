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
from services.supabase_admin import get_admin_client, get_auth_client
try:
    from security.monitor import log_security_event, record_auth_failure
except ImportError:
    def log_security_event(*a, **kw): pass
    def record_auth_failure(*a, **kw): return False

try:
    from observability_metrics import set_bff_session_store
except Exception:
    def set_bff_session_store(*a, **kw): return None


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["BFF Auth"])
_bearer = HTTPBearer()

# Armazenamento de sessão movido p/ services/session_store.py (FASE P3.3) —
# o middleware/ precisa resolver token sem importar routes/.
from services import session_store
from services.session_store import (  # noqa: F401  (re-export p/ compat)
    TOKEN_TTL, resolve_token, _check_table, _sessions_fallback,
)
_issue_token = session_store.issue_token

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

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str | None = None

class RefreshRequest(BaseModel):
    token: str

class LogoutRequest(BaseModel):
    token: str

class ResetRequest(BaseModel):
    email: str


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
        log_security_event("login_rate_limited", {"email": req.email[:30]}, severity="MEDIUM")
        raise HTTPException(429, "Too many login attempts. Please try again later.")

    try:
        client = get_auth_client()  # auth: cliente separado (não polui o de DB)
        r = client.auth.sign_in_with_password({"email": req.email, "password": req.password})
    except Exception:
        record_auth_failure(ip="server", user_id=req.email)
        raise HTTPException(401, "Invalid credentials")
    if not r or not r.session:
        record_auth_failure(ip="server", user_id=req.email)
        raise HTTPException(401, "Authentication failed")
    jwt = r.session.access_token
    refresh_tok = r.session.refresh_token
    uid = r.user.id
    email = r.user.email or req.email
    plan = _get_plan(uid)
    return _issue_token(jwt, refresh_tok, uid, email, plan)


_EMAIL_RE = __import__("re").compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _admin_emails() -> set[str]:
    """Allowlist de admins — env ADMIN_EMAILS, separada por vírgula, case-insensitive."""
    return {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "devdiegopro@gmail.com").split(",") if e.strip()}


@router.post("/admin-login")
async def admin_login(req: LoginRequest):
    """
    Login do painel de admin (/nexussafe/). Mesma validação de senha do /auth/login
    (Supabase), MAS só emite token se o e-mail estiver em ADMIN_EMAILS.
    O gate de admin é revalidado em TODA rota /admin/* por require_super_admin —
    este endpoint é só o ingresso.
    """
    if not _check_login_rate_limit(req.email):
        log_security_event("admin_login_rate_limited", {"email": req.email[:40]}, severity="MEDIUM")
        raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")

    if (req.email or "").strip().lower() not in _admin_emails():
        # Não vaza se a senha está certa — nega antes de checar credencial.
        log_security_event("admin_login_denied", {"email": req.email[:40]}, severity="HIGH")
        raise HTTPException(403, "Acesso restrito a administradores.")

    try:
        client = get_auth_client()
        r = client.auth.sign_in_with_password({"email": req.email, "password": req.password})
    except Exception:
        record_auth_failure(ip="server", user_id=req.email)
        raise HTTPException(401, "Credenciais inválidas.")
    if not r or not r.session:
        record_auth_failure(ip="server", user_id=req.email)
        raise HTTPException(401, "Credenciais inválidas.")

    uid = r.user.id
    email = r.user.email or req.email
    out = _issue_token(r.session.access_token, r.session.refresh_token, uid, email, _get_plan(uid))
    log_security_event("admin_login_ok", {"email": email[:40]}, severity="INFO")
    return out


@router.post("/signup")
async def signup(req: SignupRequest):
    """
    Cria uma conta. O Supabase envia o e-mail de confirmação (se habilitado).
    Contrato esperado pelo front (src/core/auth.ts):
      400 {detail:{error:'email_already_registered'}} · 422 e-mail inválido · 200 {ok:true}
    """
    if not _EMAIL_RE.match(req.email or ""):
        raise HTTPException(422, "invalid email")
    if not req.password or len(req.password) < 6:
        raise HTTPException(400, {"error": "weak_password"})
    if not _check_login_rate_limit(req.email):
        raise HTTPException(429, "Too many attempts. Please try again later.")

    # Cria já confirmado (não depende do SMTP do Supabase, que é frágil e rate-limited).
    # O produto promete "ativo em 30 segundos" — o usuário loga em seguida.
    try:
        admin = get_admin_client()
        created = admin.auth.admin.create_user({
            "email": req.email,
            "password": req.password,
            "email_confirm": True,
            "user_metadata": {"display_name": req.display_name or ""},
        })
    except Exception as e:
        msg = str(e).lower()
        if "already" in msg or "registered" in msg or "exists" in msg or "duplicate" in msg:
            raise HTTPException(400, {"error": "email_already_registered"})
        logger.warning(f"signup failed for {req.email[:40]}: {e}")
        raise HTTPException(400, {"error": "signup_failed"})

    uid = getattr(getattr(created, "user", None), "id", None)
    log_security_event("signup", {"email": req.email[:40]}, severity="LOW")

    # e-mail de boas-vindas (best-effort, não bloqueia)
    try:
        from routes.lifecycle_emails import send_welcome
        import asyncio
        asyncio.get_event_loop().create_task(send_welcome(uid or "", req.email))
    except Exception:
        pass

    return {"ok": True, "confirmation_required": False}

@router.post("/refresh")
async def refresh(req: RefreshRequest):
    session = resolve_token(req.token)
    try:
        client = get_auth_client()  # auth: cliente separado
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
    current_plan = _get_plan(session["user_id"])
    session["plan"] = current_plan

    # Fetch onboarding_seen flag from user profile (Supabase)
    onboarding_seen = False
    try:
        client = get_admin_client()
        user_data = client.table("profiles").select("onboarding_seen").eq("id", session["user_id"]).single().execute()
        if user_data.data:
            onboarding_seen = user_data.data.get("onboarding_seen", False)
    except Exception:
        onboarding_seen = False

    return {
        "user_id": session["user_id"],
        "email": session["email"],
        "plan": current_plan,
        "expires_at": session["expires_at"],
        "onboarding_seen": onboarding_seen,
    }

@router.post("/mark-onboarding-seen")
async def mark_onboarding_seen(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Mark onboarding as seen for current user — server-side flag."""
    token = creds.credentials
    if token.count(".") == 2:
        raise HTTPException(status_code=401, detail="Raw JWT not accepted")
    try:
        session = resolve_token(token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = session["user_id"]
    try:
        client = get_admin_client()
        client.table("profiles").update({"onboarding_seen": True}).eq("id", user_id).execute()
        return {"ok": True}
    except Exception as e:
        logger.warning(f"mark_onboarding_seen error for {user_id}: {e}")
        return {"ok": False}

@router.get("/usage")
async def usage(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Return usage stats for authenticated user (today, monthly, total, DLP counts)."""
    token = creds.credentials
    if token.count(".") == 2:
        raise HTTPException(status_code=401, detail="Raw JWT not accepted")
    try:
        session = resolve_token(token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = session["user_id"]

    try:
        client = get_admin_client()
        from datetime import datetime, timedelta, timezone

        # DLP events: protected_count = records with was_rewritten=true, scans_total = all dlp_events
        dlp_data = client.table("dlp_events").select("was_rewritten").eq("user_id", user_id).execute()
        dlp_events = dlp_data.data or []
        protected_count = sum(1 for e in dlp_events if e.get("was_rewritten"))
        scans_total = len(dlp_events)

        # Gerações: contadas em dlp_events (event_type='generate_prompt') — a MESMA
        # fonte que o rate limiter usa. (Antes lia 'telemetry_persistence', tabela
        # que não existe → today/monthly/total ficavam sempre 0.)
        # FASE 10.9.5 — "hoje" tem que virar no fuso de negócio (BUSINESS_TZ,
        # mesmo usado pelo rate limiter), não em meia-noite UTC (21h em
        # Brasília) — senão o contador exibido diverge do limite realmente
        # aplicado e o usuário vê "1/5" tendo usado 2x no mesmo dia local.
        from dlp.rate_limit import BUSINESS_TZ
        now_local = datetime.now(BUSINESS_TZ)
        today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        month_start = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

        def _dt(s: str):
            return datetime.fromisoformat(s.replace("Z", "+00:00"))

        gen = (client.table("dlp_events").select("created_at")
               .eq("user_id", user_id).eq("event_type", "generate_prompt").execute())
        gens = gen.data or []
        today = sum(1 for t in gens if _dt(t["created_at"]) >= today_start)
        monthly = sum(1 for t in gens if _dt(t["created_at"]) >= month_start)
        total = len(gens)

        return {
            "today": today,
            "monthly": monthly,
            "total": total,
            "protected_count": protected_count,
            "scans_total": scans_total,
        }
    except Exception as e:
        logger.warning(f"usage endpoint error for user {user_id}: {e}")
        # Return safe defaults if query fails
        return {"today": 0, "monthly": 0, "total": 0, "protected_count": 0, "scans_total": 0}

@router.post("/reset-password")
async def reset_password(req: ResetRequest):
    """
    Reset backend-driven: gera o link de recuperação (admin.generate_link) e envia
    via Resend. Não depende do SMTP do Supabase (que é frágil/mal configurado).
    Sempre retorna {ok:true} (não vaza se o e-mail existe).
    """
    if not _EMAIL_RE.match(req.email or ""):
        return {"ok": True}
    if not _check_login_rate_limit(req.email):
        return {"ok": True}

    try:
        r = get_admin_client().auth.admin.generate_link({
            "type": "recovery",
            "email": req.email,
            "options": {"redirect_to": "https://api.atennaia.com.br/auth/callback"},
        })
        props = getattr(r, "properties", None)
        token_hash = getattr(props, "hashed_token", None) if props is not None else (
            (r.get("properties", {}) if isinstance(r, dict) else {}).get("hashed_token")
        )
        if token_hash:
            # Link para NOSSA página com o token_hash — o /auth/v1/verify só é
            # chamado no clique do usuário (não quando um scanner de e-mail abre o link).
            reset_url = (
                "https://api.atennaia.com.br/auth/callback"
                f"?token_hash={token_hash}&type=recovery"
            )
            from routes.email_service import render_reset_password, send_email
            await send_email(
                req.email,
                "Redefina sua senha — Atenna Safe Prompt",
                render_reset_password(reset_url, req.email),
            )
    except Exception as e:
        # e-mail inexistente → generate_link lança; não é erro pro cliente
        logger.info(f"reset-password: {type(e).__name__} para {req.email[:40]}")

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

class GoogleAuthRequest(BaseModel):
    # O front (bffClient.ts) manda OU {code, redirect_uri} (PKCE) OU
    # {access_token, refresh_token} (fluxo implícito). Todos opcionais no schema;
    # o handler valida que veio pelo menos um.
    code: str | None = None
    redirect_uri: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None


@router.post("/google")
async def google_auth(req: GoogleAuthRequest):
    if not req.code and not req.access_token:
        raise HTTPException(422, "code ou access_token é obrigatório")
    try:
        client = get_auth_client()  # auth: cliente separado
        if req.access_token:
            # fluxo implícito: o front já obteve os tokens do Supabase no fragmento
            r = client.auth.set_session(req.access_token, req.refresh_token or "")
        else:
            r = client.auth.exchange_code_for_session({
                "provider": "google",
                "code": req.code,
            })
    except Exception as e:
        logger.error(f"Google auth error: {e}")
        raise HTTPException(401, "Google authentication failed")
    
    if not r or not r.session or not getattr(r, "user", None):
        raise HTTPException(401, "Authentication failed")

    jwt = r.session.access_token
    refresh_tok = r.session.refresh_token
    uid = r.user.id
    email = r.user.email
    plan = _get_plan(uid)
    return _issue_token(jwt, refresh_tok, uid, email, plan)
