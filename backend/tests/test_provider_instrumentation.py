"""
FASE 10.9 (B11) — instrumentação de provider/latência.

O dono relatou "demora a mais" no Gemini. Achado: Gemini só entra como
FALLBACK quando o OpenAI (primário) falha, e é ~8s contra ~4.7s do OpenAI —
não é regressão, é o design. O Counter do Prometheus (`record_generation`) é
só em memória e zera a cada deploy — não dá pra tirar p50/p95 dele. Este
teste garante que `generate_prompts()` sempre marca qual provider serviu e
quanto levou, pra virar histórico durável em `dlp_events` (via `audit_log`).
"""
import pytest


@pytest.mark.asyncio
async def test_openai_ok_marca_provider_e_tempo(monkeypatch):
    import services.prompt_service as ps

    async def ok(*a, **k):
        return {"direct": "d", "technical": "t", "structured": "s"}

    monkeypatch.setattr(ps, "generate_prompts_openai", ok)
    r = await ps.generate_prompts("texto qualquer", user_id="u1")
    assert r["_provider"] == "openai"
    assert isinstance(r["_provider_ms"], int) and r["_provider_ms"] >= 0


@pytest.mark.asyncio
async def test_fallback_pro_gemini_marca_provider_e_tempo_total(monkeypatch):
    import services.prompt_service as ps

    async def boom(*a, **k):
        raise RuntimeError("openai fora do ar")

    async def ok(*a, **k):
        return {"direct": "d", "technical": "t", "structured": "s"}

    monkeypatch.setattr(ps, "generate_prompts_openai", boom)
    monkeypatch.setattr(ps, "generate_prompts_gemini", ok)
    r = await ps.generate_prompts("texto qualquer", user_id="u1")
    assert r["_provider"] == "gemini"
    assert isinstance(r["_provider_ms"], int)
    # _total_ms inclui o tempo perdido tentando o OpenAI antes de cair pro Gemini
    assert r["_total_ms"] >= r["_provider_ms"]


@pytest.mark.asyncio
async def test_ambos_falham_ainda_marca_provider_none(monkeypatch):
    import services.prompt_service as ps

    async def boom(*a, **k):
        raise RuntimeError("fora do ar")

    monkeypatch.setattr(ps, "generate_prompts_openai", boom)
    monkeypatch.setattr(ps, "generate_prompts_gemini", boom)
    r = await ps.generate_prompts("texto qualquer", user_id="u1")
    assert r["_is_fallback"] is True
    assert r["_provider"] == "none"


def test_audit_log_aceita_duration_ms():
    """audit_log precisa aceitar duration_ms sem quebrar (usado por /generate-prompts)."""
    import inspect
    from dlp.rate_limit import audit_log
    sig = inspect.signature(audit_log)
    assert "duration_ms" in sig.parameters
