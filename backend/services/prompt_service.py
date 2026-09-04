"""
Orchestrator: gpt-4.1-nano (primary) → Gemini 2.5 Flash Lite (fallback)
gpt-4.1-nano: $0.10/1M input, ~4.7s para nosso caso — mais rápido e mesmo preço que Gemini
"""
import time

from services.openai_service import generate_prompts_openai
from services.gemini_service import generate_prompts_gemini

try:
    from observability_metrics import record_generation
except Exception:  # pragma: no cover
    def record_generation(*_a, **_k):
        return None


async def generate_prompts(input_text: str, user_id: str = "") -> dict:
    """
    1. gpt-4.1-nano  ($0.10/1M input, ~4.7s)
    2. gemini-2.5-flash-lite ($0.10/1M input, ~8s)
    Sem templates locais — retorna erro se ambos falharem.
    """
    # FASE 10.9 (B11) — o dono percebeu "demora a mais" no Gemini. Gemini só
    # entra quando o OpenAI (primário, ~4.7s) falha — e é ~8s (quase o dobro).
    # Marca qual provider serviu + quanto levou, gravado no audit_log
    # (dlp_events.metadata) pelo chamador — o Counter do Prometheus é só
    # em memória e zera a cada deploy, não dá pra tirar p50/p95 dele.
    t0 = time.monotonic()

    # 1. OpenAI gpt-4.1-nano  — bug num provider nunca pode virar 500 pro usuário
    try:
        result = await generate_prompts_openai(input_text, user_id=user_id)
        if result:
            record_generation("openai", "ok")
            result["_provider"] = "openai"
            result["_provider_ms"] = int((time.monotonic() - t0) * 1000)
            return result
        record_generation("openai", "error")
    except Exception as exc:
        record_generation("openai", "error")
        print(f'[Atenna] OpenAI exception: {type(exc).__name__}: {exc}')

    # 2. Gemini fallback
    print('[Atenna] OpenAI falhou — tentando Gemini como fallback...')
    t_gemini = time.monotonic()
    try:
        result = await generate_prompts_gemini(input_text, user_id=user_id)
        if result:
            record_generation("gemini", "ok")
            result["_provider"] = "gemini"
            result["_provider_ms"] = int((time.monotonic() - t_gemini) * 1000)
            result["_total_ms"] = int((time.monotonic() - t0) * 1000)  # inclui o tempo perdido no OpenAI
            return result
        record_generation("gemini", "error")
    except Exception as exc:
        record_generation("gemini", "error")
        print(f'[Atenna] Gemini exception: {type(exc).__name__}: {exc}')

    # Ambas falharam
    print('[Atenna] Ambas as APIs falharam')
    record_generation("none", "fallback")
    return {'_is_fallback': True, 'direct': '', 'technical': '', 'structured': '',
            '_provider': 'none', '_provider_ms': int((time.monotonic() - t0) * 1000)}
