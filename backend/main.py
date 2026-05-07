from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
import json

from schemas.prompt_schema import PromptRequest, PromptResponse
from services.gemini_service import generate_prompts
from routes.analytics import router as analytics_router
from routes.auth import router as auth_router
from routes.dlp import router as dlp_router
from middleware.auth import require_auth
from dlp.enforcement import evaluate_strict_enforcement

app = FastAPI(
    title="Atenna Guard Prompt — Backend",
    description="Gera 3 versões otimizadas de prompt usando Gemini Flash 1.5",
    version="1.0.0",
)

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

    # Log DLP metadata arrival
    print(json.dumps({
        "event": "dlp_prompt_received",
        "dlp_risk_level": dlp_meta.get("dlp_risk_level", "NONE"),
        "dlp_entity_count": dlp_meta.get("dlp_entity_count", 0),
        "dlp_entity_types": dlp_meta.get("dlp_entity_types", []),
        "dlp_was_rewritten": dlp_meta.get("dlp_was_rewritten", False),
        "dlp_user_override": dlp_meta.get("dlp_user_override", False),
        "user_id": user_id,
    }), flush=True)

    # Avalia se deve aplicar proteção rigorosa
    enforcement_result = evaluate_strict_enforcement(
        input_text,
        dlp_meta,
    )

    # Usa payload reescrito se strict mode aplicou proteção
    final_input = enforcement_result["rewritten_text"]

    # Log decision
    if enforcement_result["would_apply"]:
        print(json.dumps({
            "event": "dlp_strict_evaluated",
            "risk_level": dlp_meta.get("dlp_risk_level", "NONE"),
            "would_apply": True,
            "applied": enforcement_result["applied"],
            "user_id": user_id,
        }), flush=True)

    result = await generate_prompts(final_input)
    return PromptResponse(**result)
