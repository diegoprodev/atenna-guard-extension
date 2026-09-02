"""
FASE 9.0 — dlp/scanner.py (path de documentos) NÃO pode regredir.

Decisão da spec: manter a versão de PRODUÇÃO do scanner (tem padrões contextuais
que o repo não tinha). Estes testes travam o comportamento atual.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dlp.scanner import scan  # noqa: E402


def test_S1_mascara_cpf_rg_cartao_e_bloqueia():
    r = scan("Meu CPF e 111.444.777-35, RG 12.345.678-9, cartao 4111 1111 1111 1111")
    assert r.masked_content == "Meu CPF e [CPF], RG [RG], [CARTAO]"
    assert r.risk_level.value == "HIGH"
    assert r.blocked is True
    assert set(r.entity_types) >= {"CPF", "RG", "CREDIT_CARD"}


def test_S2_cpf_por_keyword_sem_checkdigit():
    # CPF com dígito verificador errado, mas precedido de "CPF:" — contextual
    r = scan("Dados: CPF: 123.456.789-00 informado pelo cliente")
    assert "CPF" in r.entity_types


def test_S3_numero_de_processo_CNJ():
    r = scan("dados do processo nº 0001234-56.2024.8.26.0100 em anexo")
    assert r.risk_level.value == "HIGH"
    assert "PROCESS_NUMBER" in r.entity_types
    # NOTA (code review FASE 9.0): o padrão LEGAL_CONTEXT do scanner de prod
    # (sentença/mandado/habeas) não está disparando — bug pré-existente,
    # follow-up fora do escopo desta fase.


def test_S4_texto_neutro_nao_bloqueia_nem_mascara():
    txt = "Como estruturar uma arquitetura de microsserviços escalável?"
    r = scan(txt)
    assert r.risk_level.value == "NONE"
    assert r.blocked is False
    assert r.masked_content == txt


def test_S5_email_detectado():
    r = scan("me contate em joao.silva@empresa.com.br por favor")
    assert any(t in ("EMAIL", "EMAIL_ADDRESS") for t in r.entity_types)
