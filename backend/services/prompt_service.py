"""
Orchestrator: gpt-4.1-nano (primary) → Gemini 2.5 Flash Lite (fallback)
gpt-4.1-nano: $0.10/1M input, ~4.7s para nosso caso — mais rápido e mesmo preço que Gemini
"""
from services.openai_service import generate_prompts_openai
from services.gemini_service import generate_prompts_gemini


async def generate_prompts(input_text: str) -> dict:
    """
    1. gpt-4.1-nano  ($0.10/1M input, ~4.7s)
    2. gemini-2.5-flash-lite ($0.10/1M input, ~8s)
    Sem templates locais — retorna erro se ambos falharem.
    """
    # 1. OpenAI gpt-4.1-nano
    result = await generate_prompts_openai(input_text)
    if result:
        return result

    # 2. Gemini fallback
    print("[Atenna] OpenAI falhou — tentando Gemini como fallback...")
    result = await generate_prompts_gemini(input_text)
    if result:
        return result

    # Ambas falharam — sinaliza erro para o frontend exibir mensagem clara
    print("[Atenna] Ambas as APIs falharam")
    return {"_is_fallback": True, "direct": "", "technical": "", "structured": ""}
