from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
import json

from schemas.prompt_schema import PromptRequest, PromptResponse
from services.gemini_service import generate_prompts
from routes.analytics import router as analytics_router
from routes.auth import router as auth_router
from routes.dlp import router as dlp_router
from routes.retention import router as retention_router
from routes.deletion import router as deletion_router
from middleware.auth import require_auth
from dlp.enforcement import evaluate_strict_enforcement
from dlp import engine, telemetry
from dlp.exception_sanitizer import SanitizationMiddleware

app = FastAPI(
    title="Atenna Guard Prompt — Backend",
    description="Gera 3 versões otimizadas de prompt usando Gemini Flash 1.5",
    version="1.0.0",
)

# TASK 7: Exception Sanitization (prevent PII leakage in error logs)
app.add_middleware(SanitizationMiddleware)

# CORS enterprise — apenas origens autorizadas
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

    user_id = _user.get("sub")
    input_text = request.input
    dlp_meta = request.dlp or {}

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

    result = await generate_prompts(final_input)
    return PromptResponse(**result)
