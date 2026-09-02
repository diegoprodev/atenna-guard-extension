"""
FASE 9.0 — dlp/pipeline.py reconciliado.

Invariantes:
- run() é async (routes/dlp.py faz `await run(request)`)
- timeout na análise → risk_level UNKNOWN (nunca NONE — não mascarar falha como "seguro")
- exceção na análise → UNKNOWN + telemetria de erro
- caminho feliz detecta PII de verdade
"""
import asyncio
import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dlp import pipeline as pipeline_mod  # noqa: E402
from dlp.entities import RiskLevel, ScanRequest  # noqa: E402


def test_P2_run_e_coroutine():
    assert inspect.iscoroutinefunction(pipeline_mod.run), (
        "pipeline.run precisa ser async — routes/dlp.py faz `await run(request)`"
    )


@pytest.mark.asyncio
async def test_P1_caminho_feliz_detecta_cpf():
    resp = await pipeline_mod.run(ScanRequest(text="Meu CPF é 111.444.777-35", platform="test"))
    assert resp.risk_level in (RiskLevel.HIGH, RiskLevel.MEDIUM)
    assert any(e.type == "BR_CPF" for e in resp.entities)


@pytest.mark.asyncio
async def test_P3_timeout_retorna_UNKNOWN_nunca_NONE(monkeypatch):
    def analyze_lento(_text):
        import time
        time.sleep(pipeline_mod.SCAN_TIMEOUT_SECONDS + 2)
        return []
    monkeypatch.setattr(pipeline_mod, "analyze", analyze_lento)
    resp = await pipeline_mod.run(ScanRequest(text="qualquer coisa aqui", platform="test"))
    assert resp.risk_level == RiskLevel.UNKNOWN
    assert resp.risk_level != RiskLevel.NONE


@pytest.mark.asyncio
async def test_P4_excecao_retorna_UNKNOWN(monkeypatch):
    def analyze_quebrado(_text):
        raise RuntimeError("presidio explodiu")
    monkeypatch.setattr(pipeline_mod, "analyze", analyze_quebrado)
    resp = await pipeline_mod.run(ScanRequest(text="texto de teste aqui", platform="test"))
    assert resp.risk_level == RiskLevel.UNKNOWN


@pytest.mark.asyncio
async def test_P5_texto_vazio_nao_quebra():
    resp = await pipeline_mod.run(ScanRequest(text="", platform="test"))
    assert resp.risk_level in (RiskLevel.NONE, RiskLevel.UNKNOWN)


@pytest.mark.asyncio
async def test_P_regressao_prod_nunca_retorna_NONE_em_erro(monkeypatch):
    """O bug de produção: except -> RiskLevel.NONE (mascara falha como seguro)."""
    def boom(_):
        raise ValueError("x")
    monkeypatch.setattr(pipeline_mod, "analyze", boom)
    resp = await pipeline_mod.run(ScanRequest(text="Meu CPF 111.444.777-35", platform="p"))
    assert resp.risk_level is not RiskLevel.NONE, (
        "erro de análise NUNCA pode virar risk=NONE — usa UNKNOWN"
    )
