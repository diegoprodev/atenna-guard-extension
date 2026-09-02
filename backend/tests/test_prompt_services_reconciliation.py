"""
FASE 9.0 — os serviços de LLM constroem o system prompt sem quebrar.

Bug pré-existente: _SYSTEM_PROMPT_TEMPLATE contém JSON literal {"direct":...}
e o código fazia .format(canary=...) → KeyError → /generate-prompts 500.
Ambos os providers (OpenAI e Gemini) tinham o mesmo bug.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_openai_template_monta_sem_keyerror():
    from services import openai_service as s
    prompt = s._SYSTEM_PROMPT_TEMPLATE.replace("{canary}", "CANARY-123")
    assert "CANARY-123" in prompt
    assert '{"direct"' in prompt  # o JSON literal sobrevive intacto
    assert "{canary}" not in prompt


def test_gemini_template_monta_sem_keyerror():
    from services import gemini_service as s
    prompt = s._SYSTEM_INSTRUCTION_TEMPLATE.replace("{canary}", "CANARY-123")
    assert "CANARY-123" in prompt
    assert '{"direct"' in prompt
    assert "{canary}" not in prompt


def test_nenhum_service_usa_format_no_template():
    """Garante que ninguém volta a usar .format() (que quebra com o JSON literal)."""
    import inspect
    from services import openai_service, gemini_service
    for mod in (openai_service, gemini_service):
        src = inspect.getsource(mod)
        assert "_TEMPLATE.format(" not in src and "_INSTRUCTION_TEMPLATE.format(" not in src, (
            f"{mod.__name__}: use .replace('{{canary}}', canary), não .format()"
        )


@pytest.mark.asyncio
async def test_prompt_service_degrada_para_fallback_nao_500(monkeypatch):
    """Se um provider levantar exceção, generate_prompts devolve _is_fallback, nunca propaga."""
    import services.prompt_service as ps

    async def boom(*a, **k):
        raise RuntimeError("provider quebrou")

    monkeypatch.setattr(ps, "generate_prompts_openai", boom)
    monkeypatch.setattr(ps, "generate_prompts_gemini", boom)
    r = await ps.generate_prompts("qualquer texto", user_id="x")
    assert r.get("_is_fallback") is True
