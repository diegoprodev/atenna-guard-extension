"""
FASE 10.9 — 429/erro de provider tem que virar logger.error (chega no
GlitchTip via LoggingIntegration(event_level="ERROR"), configurado em
observability.py), nunca só um print() que morre no stdout do container.

Achado ao investigar "chegou uma mensagem de créditos de 429, qual a
origem?" — o código antigo fazia `except RateLimitError: print(...)`,
descartando o corpo do erro (que distingue rate_limit_exceeded transitório
de insufficient_quota, que não resolve sozinho) e nunca reportava a
observabilidade.
"""
import logging

import httpx
import pytest
from openai import RateLimitError


@pytest.mark.asyncio
async def test_openai_rate_limit_logs_full_detail_via_logger(monkeypatch, caplog):
    import services.openai_service as svc

    body = {"error": {"type": "insufficient_quota", "message": "You exceeded your current quota"}}
    resp = httpx.Response(
        429,
        request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"),
        json=body,
    )
    err = RateLimitError("rate limited", response=resp, body=body)

    class FakeCompletions:
        async def create(self, **_kw):
            raise err

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

        def __init__(self, *_a, **_k):
            pass

    monkeypatch.setattr(svc, "AsyncOpenAI", FakeClient)
    monkeypatch.setattr(svc, "OPENAI_API_KEY", "sk-test-fake")

    with caplog.at_level(logging.ERROR, logger="services.openai_service"):
        result = await svc.generate_prompts_openai(
            "pergunta de teste com tamanho suficiente pra passar do sanitizador"
        )

    assert result is None
    # a mensagem tem que carregar o tipo real do erro (insufficient_quota),
    # não só "rate limit atingido" genérico
    assert any("insufficient_quota" in r.message for r in caplog.records), (
        f"logs capturados: {[r.message for r in caplog.records]}"
    )


def test_openai_missing_key_is_logged_error():
    """Chave ausente é erro de config — tem que ficar visível, não sumir num print."""
    import inspect
    src = inspect.getsource(__import__("services.openai_service", fromlist=["x"]))
    assert 'print("[Atenna] OPENAI_API_KEY não configurada")' not in src
    assert "logger.error" in src


def test_gemini_missing_key_is_logged_error():
    import inspect
    src = inspect.getsource(__import__("services.gemini_service", fromlist=["x"]))
    assert 'print("[Atenna] GEMINI_API_KEY não configurada")' not in src
    assert "logger.error" in src
