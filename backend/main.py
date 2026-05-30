import asyncio
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:4200",
    "http://localhost:5173",
]
import json

from schemas.prompt_schema import PromptRequest, PromptResponse
from services.prompt_service import generate_prompts
from routes.analytics import router as analytics_router
from routes.auth import router as auth_router
from routes.dlp import router as dlp_router
from routes.retention import router as retention_router
from routes.deletion import router as deletion_router
from routes.export import router as export_router
from routes.documents import router as documents_router
from routes.protect import router as protect_router
from routes.report_problem import router as report_problem_router
from routes.upload import router as upload_router
from routes.upload_large import router as upload_large_router
from middleware.auth import require_auth
from middleware.security_headers import SecurityHeadersMiddleware
from routes.metrics import router as metrics_router
from dlp.enforcement import evaluate_strict_enforcement
from dlp import engine, telemetry
from dlp.exception_sanitizer import SanitizationMiddleware
from dlp.rate_limit import check_rate_limit, audit_log, get_user_plan
from routes.admin import router as admin_router
from routes.checkout import router as checkout_router
from routes.export_protected import router as export_protected_router
from routes.bff_auth import router as bff_auth_router
from routes.admin_security import router as admin_security_router
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from routes.renewal import run_renewal_check, run_renewal_urgent
from routes.bff_auth import cleanup_old_dlp_events
from routes.lifecycle_emails import run_onboarding_d1, run_upsell, send_welcome, send_pro_welcome


@asynccontextmanager
async def _lifespan(app):
    scheduler = AsyncIOScheduler(timezone="America/Sao_Paulo")
    scheduler.add_job(run_renewal_check,  "cron", hour=9,  minute=0,  id="daily_renewal_30d",   replace_existing=True)
    scheduler.add_job(run_renewal_urgent, "cron", hour=9,  minute=15, id="daily_renewal_7d",    replace_existing=True)
    scheduler.add_job(run_onboarding_d1, "cron", hour=10, minute=0,  id="daily_onboarding_d1", replace_existing=True)
    scheduler.add_job(run_upsell,        "cron", hour=11, minute=0,  id="daily_upsell",         replace_existing=True)
    scheduler.add_job(cleanup_old_dlp_events, "cron", hour=3, minute=0, id="daily_dlp_cleanup", replace_existing=True)
    scheduler.start()
    import logging
    logging.getLogger(__name__).info("[SCHEDULER] All lifecycle jobs scheduled")
    yield
    scheduler.shutdown(wait=False)

app = FastAPI(
    title="Atenna Guard Prompt Backend",
    description="Gera 3 versoes otimizadas de prompt usando Gemini Flash 1.5",
    version="1.0.0",
    lifespan=_lifespan,
)

# TASK 7: Exception Sanitization (prevent PII leakage in error logs)
app.add_middleware(SanitizationMiddleware)

# Security headers on every response
app.add_middleware(SecurityHeadersMiddleware)

# CORS enterprise — apenas origens autorizadas
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "apikey"],
    allow_credentials=False,
    max_age=86400,
)

app.include_router(analytics_router)
app.include_router(auth_router)
app.include_router(dlp_router)
app.include_router(retention_router)
app.include_router(deletion_router)
app.include_router(export_router)
app.include_router(documents_router)
app.include_router(protect_router)
app.include_router(report_problem_router)
app.include_router(upload_router)
app.include_router(upload_large_router)
app.include_router(metrics_router)
app.include_router(admin_router)
app.include_router(checkout_router)
app.include_router(export_protected_router)
app.include_router(bff_auth_router)
app.include_router(admin_security_router)


@app.get("/health", tags=["Health"])
async def health():
    """Verifica se o servidor está no ar."""
    return {"status": "ok"}


@app.post("/generate-prompts", response_model=PromptResponse, tags=["Prompts"])
async def generate(
    request: PromptRequest,
    _user: dict = Depends(require_auth),   # 401 if no valid JWT
):
    """
    Recebe o texto do usuário e retorna 3 versões otimizadas via Gemini.
    Requer JWT válido do Supabase (Bearer token).
    Recebe metadata DLP do cliente para validação server-side.
    Aplica proteção rigorosa se STRICT_DLP_MODE=true e risco=HIGH.
    """
    if not request.input.strip():
        raise HTTPException(status_code=422, detail="Campo 'input' não pode ser vazio.")

    user_id = _user.get("id") or _user.get("sub")
    input_text = request.input

    # ─── SERVER-SIDE RATE LIMITING ───────────────────────────────────────────
    # Free plan: max 5 prompts/day, enforced server-side (client-side can be bypassed)
    plan = get_user_plan(user_id) if user_id else "free"
    quota = check_rate_limit(user_id, plan) if user_id else {"allowed": True, "count": 0, "limit": 5, "reset_at": None}

    if not quota["allowed"]:
        # Audit: log the blocked attempt
        audit_log(
            user_id,
            "quota_exceeded",
            quota_count=quota["count"],
            metadata={"plan": plan, "limit": quota["limit"]},
        )
        window = quota.get("window", "day")
        window_msgs = {
            "hour": "Limite por hora atingido. Aguarde o próximo ciclo.",
            "day": "Limite diário atingido. Aguarde o reset às meia-noite.",
            "week": "Limite semanal atingido.",
            "month": "Limite mensal atingido.",
        }
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": window_msgs.get(window, "Limite atingido."),
                "count": quota["count"],
                "limit": quota["limit"],
                "window": window,
                "reset_at": quota["reset_at"],
            },
        )
    # Convert Pydantic DlpMetadataRequest to dict if present
    if request.dlp:
        dlp_meta = request.dlp.model_dump(exclude_none=True) if hasattr(request.dlp, 'model_dump') else request.dlp.__dict__
    else:
        dlp_meta = {}

    # Session ID for telemetry tracking
    session_id = dlp_meta.get("dlp_session_id")

    # Log DLP metadata arrival
    print(json.dumps({
        "event": "dlp_prompt_received",
        "dlp_risk_level": dlp_meta.get("dlp_risk_level", "NONE"),
        "dlp_entity_count": dlp_meta.get("dlp_entity_count", 0),
        "dlp_entity_types": dlp_meta.get("dlp_entity_types", []),
        "dlp_was_rewritten": dlp_meta.get("dlp_was_rewritten", False),
        "dlp_user_override": dlp_meta.get("dlp_user_override", False),
        "user_id": user_id,
        "session_id": session_id,
    }), flush=True)

    # ─── TASK 4: Server-side Revalidation (without HTTP internal call) ───
    # ─── TASK 5: With timeout protection ───
    # Use shared engine directly (no /dlp/scan HTTP call)
    server_analysis, mismatch = await engine.revalidate(
        input_text,
        dlp_meta,
        session_id=session_id,
    )

    # Log revalidation result
    telemetry.server_revalidated(
        session_id=session_id,
        text_hash=server_analysis.text_hash,
        client_risk=dlp_meta.get("dlp_risk_level", "NONE"),
        server_risk=server_analysis.risk_level,
        protected_tokens_detected=server_analysis.protected_tokens_detected,
    )

    # Log if mismatch detected
    if mismatch.has_mismatch:
        print(json.dumps({
            "event": "dlp_client_server_divergence",
            "divergence_type": mismatch.divergence_type,
            "client_risk": mismatch.client_risk,
            "server_risk": mismatch.server_risk,
            "client_entities": mismatch.client_entity_count,
            "server_entities": mismatch.server_entity_count,
            "confidence": round(mismatch.confidence, 2),
            "user_id": user_id,
            "session_id": session_id,
        }), flush=True)

    # ─── Strict Mode: Use server result for enforcement ───
    # Create enforcement metadata from server analysis
    server_dlp_meta = {
        "dlp_risk_level": server_analysis.risk_level,
        "dlp_entity_count": len(server_analysis.entities),
        "dlp_entity_types": server_analysis.entity_types,
        "dlp_was_rewritten": server_analysis.was_rewritten,
    }

    # Evaluate strict enforcement using SERVER analysis
    enforcement_result = evaluate_strict_enforcement(
        input_text,
        server_dlp_meta,  # Use server, not client
        entities=server_analysis.entities,  # Pass actual entities from server analysis
    )

    # Usa payload reescrito se strict mode aplicou proteção
    final_input = enforcement_result["rewritten_text"]

    # Log enforcement decision
    if enforcement_result["would_apply"]:
        print(json.dumps({
            "event": "dlp_strict_evaluated",
            "risk_level": server_analysis.risk_level,
            "would_apply": True,
            "applied": enforcement_result["applied"],
            "source": "server_revalidation",
            "user_id": user_id,
            "session_id": session_id,
        }), flush=True)

    try:
        result = await asyncio.wait_for(generate_prompts(final_input, user_id=user_id or ""), timeout=40.0)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="upstream_timeout")

    # ─── AUDIT LOG ────────────────────────────────────────────────────────────
    # Record every successful generation for LGPD Art. 37 audit trail
    if user_id:
        audit_log(
            user_id,
            "generate_prompt",
            risk_level=server_analysis.risk_level,
            entity_types=server_analysis.entity_types,
            entity_count=len(server_analysis.entities),
            was_rewritten=enforcement_result.get("applied", False),
            user_override=dlp_meta.get("dlp_user_override", False),
            quota_count=quota.get("count", 0) + 1,
            session_id=session_id,
            metadata={"plan": plan, "mismatch": mismatch.has_mismatch},
        )

    return PromptResponse(**result)

# Static privacy policy page
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

_static_dir = os.path.join(os.path.dirname(__file__), 'static')
if os.path.isdir(_static_dir):
    app.mount('/static', StaticFiles(directory=_static_dir), name='static')

@app.get('/privacy', include_in_schema=False)
async def privacy_policy():
    return FileResponse(os.path.join(_static_dir, 'privacy.html'))


@app.post('/internal/test-generate')
async def test_generate_internal(request: 'Request'):
    """Internal test endpoint — VPS only (not exposed via nginx)."""
    body = await request.json()
    user_id = body.get('user_id', 'test-user')
    text = body.get('text', 'Como escalar minha empresa SaaS?')
    try:
        result = await asyncio.wait_for(generate_prompts(text, user_id=user_id), timeout=40.0)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="upstream_timeout")
    return {'ok': True, 'user_id': user_id, 'has_direct': 'direct' in result, 'direct_snippet': str(result.get('direct',''))[:100]}


# ── Internal lifecycle email endpoints ──────────────────────────────────────

from fastapi import Header
from routes.lifecycle_emails import send_welcome as _send_welcome, send_pro_welcome as _send_pro_welcome

_INTERNAL_TOKEN = os.getenv('INTERNAL_API_TOKEN', '')

def _require_internal(x_internal_token: str = Header(default='')):
    if _INTERNAL_TOKEN and x_internal_token != _INTERNAL_TOKEN:
        raise HTTPException(status_code=403, detail='forbidden')

@app.post('/internal/email/welcome', include_in_schema=False)
async def internal_welcome(payload: dict, _: None = Depends(_require_internal)):
    user_id = payload.get('user_id', '')
    email   = payload.get('email', '')
    if not email:
        raise HTTPException(status_code=422, detail='email required')
    sent = await _send_welcome(user_id, email)
    return {'sent': sent}

@app.post('/internal/email/pro-welcome', include_in_schema=False)
async def internal_pro_welcome(payload: dict, _: None = Depends(_require_internal)):
    user_id    = payload.get('user_id', '')
    email      = payload.get('email', '')
    plan_key   = payload.get('plan_key', 'yearly')
    expires_at = payload.get('expires_at', '')
    if not email:
        raise HTTPException(status_code=422, detail='email required')
    sent = await _send_pro_welcome(user_id, email, plan_key, expires_at)
    return {'sent': sent}
