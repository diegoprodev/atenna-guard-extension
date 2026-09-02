"""
FASE 9.0 — o coração do zero-trust: engine.revalidate() no /generate-prompts.

Antes da correção, analyze() quebrava e revalidate() retornava sempre UNKNOWN/[]:
o cliente podia mentir "NONE" + mandar PII crua e o servidor não fazia nada.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dlp.engine import get_engine  # noqa: E402
from dlp.enforcement import evaluate_strict_enforcement  # noqa: E402


def test_E0_engine_nao_faz_shadowing_do_analyze_do_presidio():
    """
    Bug FASE 9.0: `from .analyzer import analyze` era sobrescrito pelo
    `async def analyze` no fim de engine.py → run_in_executor rodava a corotina
    errada → revalidate() sempre UNKNOWN mesmo com o analyzer OK.
    """
    import inspect
    import dlp.engine as eng
    import dlp.analyzer as ana
    # a função passada ao executor tem que ser a SÍNCRONA do analyzer
    assert eng._run_presidio is ana.analyze
    assert not inspect.iscoroutinefunction(eng._run_presidio)


@pytest.mark.asyncio
async def test_E1_cliente_mente_NONE_servidor_detecta_HIGH():
    eng = get_engine()
    server, mismatch = await eng.revalidate(
        text="Meu CPF é 111.444.777-35 e cartão 4111 1111 1111 1111",
        client_metadata={"dlp_risk_level": "NONE", "dlp_entity_count": 0},
    )
    assert server.risk_level == "HIGH", f"servidor devia ver HIGH, viu {server.risk_level}"
    assert mismatch.has_mismatch is True
    assert "BR_CPF" in server.entity_types


@pytest.mark.asyncio
async def test_E4_cliente_sem_metadados_servidor_revalida_do_zero():
    eng = get_engine()
    server, _ = await eng.revalidate(
        text="CNPJ 11.222.333/0001-81 e OAB/SP 123456",
        client_metadata={},
    )
    assert server.risk_level in ("HIGH", "MEDIUM")
    assert server.entity_types


@pytest.mark.asyncio
async def test_E5_revalidate_nunca_propaga_excecao(monkeypatch):
    """Bug no DLP não pode bloquear geração. Pior caso = UNKNOWN."""
    import dlp.engine as eng_mod
    def boom(*a, **k):
        raise RuntimeError("presidio caiu")
    monkeypatch.setattr(eng_mod, "_run_presidio", boom)
    eng = eng_mod.DLPEngine()
    server, _ = await eng.revalidate(text="Meu CPF 111.444.777-35", client_metadata={})
    assert server.risk_level == "UNKNOWN"


@pytest.mark.asyncio
async def test_E2_strict_mode_reescreve_payload_com_cpf(monkeypatch):
    """End-to-end: revalida no servidor e, com STRICT ligado, reescreve o payload."""
    monkeypatch.setenv("STRICT_DLP_MODE", "true")
    import dlp.enforcement as enf
    for attr in ("_strict_cache", "_STRICT_CACHE"):
        if hasattr(enf, attr):
            setattr(enf, attr, None)

    texto = "segue meu CPF 111.444.777-35 para análise"
    server, _ = await get_engine().revalidate(text=texto, client_metadata={})
    assert server.risk_level == "HIGH"

    res = evaluate_strict_enforcement(
        input_text=texto,
        server_dlp_metadata={
            "dlp_risk_level": server.risk_level,
            "dlp_entity_count": len(server.entities),
            "dlp_entity_types": server.entity_types,
            "dlp_was_rewritten": server.was_rewritten,
        },
        entities=server.entities,
    )
    assert res["would_apply"] is True
    assert res["applied"] is True
    assert "111.444.777-35" not in res["rewritten_text"], res["rewritten_text"]


def test_E3_sem_strict_nao_reescreve(monkeypatch):
    monkeypatch.setenv("STRICT_DLP_MODE", "false")
    import dlp.enforcement as enf
    if hasattr(enf, "_strict_cache"):
        enf._strict_cache = None
    res = evaluate_strict_enforcement(
        input_text="meu CPF 111.444.777-35",
        server_dlp_metadata={"dlp_risk_level": "HIGH", "dlp_entity_count": 1,
                             "dlp_entity_types": ["BR_CPF"], "dlp_was_rewritten": False},
    )
    assert res["applied"] is False
