"""
FASE 9.0 — Reconciliação do backend / correção do DLP server-side.

Garante que o motor Presidio (dlp/analyzer.py) volta a funcionar em produção:
- sobe sem exceção (o bug era CreditCardRecognizer colidindo com o built-in)
- todos os PatternRecognizer custom têm supported_language="pt"
- detecta PII BR real e NÃO gera falso positivo em documento inválido / texto técnico

Roda o Presidio + spaCy de verdade (é o que estamos validando). Sem rede.
"""
import ast
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dlp import analyzer as analyzer_mod  # noqa: E402
from dlp.analyzer import analyze, get_analyzer  # noqa: E402

ANALYZER_SRC = os.path.join(os.path.dirname(analyzer_mod.__file__), "analyzer.py")


def types_of(text: str) -> list[str]:
    return [r.entity_type for r in analyze(text)]


# ─────────────────────────── A1–A3: sanidade do módulo ───────────────────────────

def test_A1_engine_sobe_sem_excecao():
    eng = get_analyzer()
    assert eng is not None
    # segunda chamada usa o cache
    assert get_analyzer() is eng


def test_A2_nenhuma_classe_CreditCardRecognizer_sem_prefixo_BR():
    """O bug #5 do CLAUDE.md: classe custom homônima do built-in do Presidio."""
    tree = ast.parse(open(ANALYZER_SRC, encoding="utf-8").read())
    classes = [n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
    assert "CreditCardRecognizer" not in classes, (
        "classe 'CreditCardRecognizer' colide com o built-in do Presidio — use BRCreditCardRecognizer"
    )
    assert "BRCreditCardRecognizer" in classes


def test_A3_todo_PatternRecognizer_tem_supported_language_pt():
    """Bug #4 do CLAUDE.md: sem supported_language, get_recognizers(language='pt') volta vazio."""
    tree = ast.parse(open(ANALYZER_SRC, encoding="utf-8").read())
    faltando = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        bases = {getattr(b, "id", getattr(b, "attr", "")) for b in node.bases}
        if "PatternRecognizer" not in bases:
            continue
        src = ast.get_source_segment(open(ANALYZER_SRC, encoding="utf-8").read(), node) or ""
        if 'supported_language="pt"' not in src and "supported_language='pt'" not in src:
            faltando.append(node.name)
    assert not faltando, f"recognizers sem supported_language='pt': {faltando}"


# ─────────────────────────── A4–A9: detecção positiva ───────────────────────────

@pytest.mark.parametrize("texto,esperado", [
    ("Meu CPF é 111.444.777-35 para cadastro",            "BR_CPF"),
    ("CNPJ 11.222.333/0001-81 da empresa",                "BR_CNPJ"),
    ("pague no cartão 4111 1111 1111 1111",               "CREDIT_CARD"),
    ("RG: 12.345.678-9 apresentado",                       "RG"),
    ("habilitação 01234567890 do motorista",              "CNH"),
    ("inscrito na OAB/SP 123456",                          "OAB"),
    ("veículo ABC1D23 autuado",                            "PLACA"),
    ("placa antiga ABC-1234",                              "PLACA"),
    ("Dr. atende, CRM/RJ 54321",                           "CRM"),
    ("ligar no celular (11) 98765-4321",                  "BR_PHONE"),
    ("chave sk-proj-abcdefghijklmnopqrstuvwxyz012345 vazou", "API_KEY"),
    ("AWS AKIAIOSFODNN7EXAMPLE exposto",                  "API_KEY"),
    ("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", "TOKEN"),
])
def test_A4_A9_deteccao_positiva(texto, esperado):
    assert esperado in types_of(texto), f"esperava {esperado} em {types_of(texto)!r}"


# ─────────────────────────── A5/A7: sem falso positivo ───────────────────────────

def test_A5_cpf_invalido_nao_detectado():
    # dígitos verificadores errados
    assert "BR_CPF" not in types_of("documento 111.444.777-00 rejeitado")


def test_A7_cartao_luhn_invalido_nao_detectado():
    assert "CREDIT_CARD" not in types_of("número 1234 5678 9012 3456 inválido")


def test_A10_texto_tecnico_sem_falso_positivo_de_nome():
    # bug #8 do CLAUDE.md — NAME_STOPWORDS
    txt = "the observer pattern in typescript uses a subject and listeners"
    tipos = types_of(txt)
    assert "PERSON" not in tipos and "NOME" not in tipos, tipos


def test_A5_cnpj_invalido_nao_detectado():
    assert "BR_CNPJ" not in types_of("empresa 11.222.333/0001-00 fechada")
