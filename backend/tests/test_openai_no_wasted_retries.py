"""
FASE 10.9.5 — achado real do dono: geração de prompt demorando ~15s.
Causa raiz: AsyncOpenAI(max_retries=2) fazia o SDK tentar de novo (com
backoff) internamente ANTES de devolver o erro pra prompt_service.py, que
JÁ tem seu próprio fallback pro Gemini quando o OpenAI falha. As duas
camadas de retry somavam — um 429/insufficient_quota quase nunca resolve
tentando de novo no mesmo segundo, então isso só atrasava a chegada no
fallback (que sozinho já leva ~8s).

Este teste falha ANTES do fix (max_retries=2) e passa depois (max_retries=0).
"""
from unittest.mock import patch

import services.openai_service as svc


def test_openai_client_has_no_internal_retries(monkeypatch):
    captured = {}

    class FakeCompletions:
        async def create(self, **_kw):
            raise RuntimeError("stop here — só queremos inspecionar a construção do client")

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

        def __init__(self, *_a, **kw):
            captured.update(kw)

    # svc.OPENAI_API_KEY é lido uma vez no import do módulo — setar a env var
    # aqui não adianta se outro teste já importou o módulo antes (ordem de
    # coleta do pytest). monkeypatch no atributo do módulo, como
    # test_provider_error_observability.py já faz, é o jeito que funciona
    # independente de ordem de coleta.
    monkeypatch.setattr(svc, "OPENAI_API_KEY", "sk-test-fake")

    with patch.object(svc, "AsyncOpenAI", FakeClient):
        import asyncio
        asyncio.run(
            svc.generate_prompts_openai("pergunta de teste com tamanho suficiente pra passar do sanitizador")
        )

    assert captured.get("max_retries") == 0, (
        f"max_retries={captured.get('max_retries')!r} — SDK reintroduzindo retry "
        "interno que soma com o fallback pro Gemini e reintroduz o achado dos 15s."
    )
