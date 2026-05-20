"""
FASE 5.2 — PT-BR Enterprise Recognizers
Tests: RG, CNH, OAB, PLACA, CRM detection in backend Presidio engine.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dlp.analyzer import analyze


def entity_types(text: str) -> list[str]:
    return [r.entity_type for r in analyze(text)]


def test_rg_labeled():
    types = entity_types("RG: 12.345.678-9")
    assert "RG" in types


def test_rg_formatted():
    types = entity_types("documento 12.345.678-9 apresentado")
    assert "RG" in types


def test_cnh_labeled():
    types = entity_types("CNH: 01234567890")
    assert "CNH" in types


def test_cnh_habilitacao():
    types = entity_types("habilitação 01234567890")
    assert "CNH" in types


def test_oab_sp():
    types = entity_types("inscrito na OAB/SP 123456")
    assert "OAB" in types


def test_oab_rj():
    types = entity_types("OAB-RJ 98765")
    assert "OAB" in types


def test_placa_mercosul():
    types = entity_types("veículo ABC1D23 foi autuado")
    assert "PLACA" in types


def test_placa_old():
    types = entity_types("placa ABC-1234")
    assert "PLACA" in types


def test_crm_sp():
    types = entity_types("Dr. Silva CRM/SP 123456")
    assert "CRM" in types


def test_cpf_still_works():
    types = entity_types("CPF 123.456.789-09")
    assert "BR_CPF" in types


def test_cnpj_still_works():
    types = entity_types("empresa CNPJ 11.222.333/0001-81")
    assert "BR_CNPJ" in types
