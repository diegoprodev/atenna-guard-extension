from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas.prompt_schema import PromptRequest, PromptResponse
from services.gemini_service import generate_prompts
from routes.analytics import router as analytics_router

app = FastAPI(
    title="Atenna Guard Prompt — Backend",
    description="Gera 3 versões otimizadas de prompt usando Gemini Flash 1.5",
    version="1.0.0",
)

# CORS liberado para extensão Chrome e localhost durante desenvolvimento
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # em produção, restringir para a origem da extensão
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(analytics_router)


@app.get("/health", tags=["Health"])
async def health():
    """Verifica se o servidor está no ar."""
    return {"status": "ok"}


@app.post("/generate-prompts", response_model=PromptResponse, tags=["Prompts"])
async def generate(request: PromptRequest):
    """
    Recebe o texto do usuário e retorna 3 versões otimizadas via Gemini.
    Em caso de falha na API externa, retorna fallback local automaticamente.
    """
    if not request.input.strip():
        raise HTTPException(status_code=422, detail="Campo 'input' não pode ser vazio.")

    result = await generate_prompts(request.input)
    return PromptResponse(**result)
