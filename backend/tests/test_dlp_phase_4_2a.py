"""
Testes unitários — FASE 4.2A DLP Alignment
Cobre: scanner, classification, policy, governance, audit_policy,
       hash_chain, outbound security.
Critério de aprovação: todos os testes GREEN antes do merge.
"""
import sys
import os
import pytest

# Adiciona backend/ ao sys.path para imports diretos
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dlp.scanner import scan
from dlp.classification import (
    resolve_classification, resolve_max, show_warning, requires_acknowledgment,
    RISK_TO_CLASSIFICATION,
)
from dlp.policy import evaluate
from dlp.governance import (
    get_governance, provider_allowed, effective_retention,
    ModelConstraint, AuditLevel,
)
from dlp.audit_policy import resolve_audit_config, new_correlation_id, build_audit_event
from dlp.types import (
    ClassificationLevel, EntityType, RiskLevel,
    PLACEHOLDERS, CLASSIFICATION_ORDER,
)
from audit.hash_chain import (
    compute_hash, build_event, verify_chain, GENESIS_HASH, VALID_EVENTS,
)
from security.outbound import assert_safe_llm_url, is_safe_llm_url


# ─── Scanner: CPF ─────────────────────────────────────────────────────────────

def test_cpf_formatado():
    r = scan("Meu CPF é 050.423.674-11")
    assert any(f.entity_type == EntityType.CPF for f in r.findings)
    assert "[CPF]" in r.masked_content


def test_cpf_sem_mascara():
    r = scan("cpf 05042367411 para validação")
    assert any(f.entity_type == EntityType.CPF for f in r.findings)


def test_cpf_invalido_nao_detectado():
    # Dígito verificador errado — não deve detectar
    r = scan("CPF falso: 111.111.111-11")
    assert not any(f.entity_type == EntityType.CPF for f in r.findings)


def test_cpf_sequencia_igual_nao_detectado():
    r = scan("número: 000.000.000-00")
    assert not any(f.entity_type == EntityType.CPF for f in r.findings)


# ─── Scanner: CNPJ ────────────────────────────────────────────────────────────

def test_cnpj_formatado():
    r = scan("CNPJ da empresa: 11.222.333/0001-81")
    assert any(f.entity_type == EntityType.CNPJ for f in r.findings)
    assert "[CNPJ]" in r.masked_content


def test_cnpj_invalido_nao_detectado():
    r = scan("CNPJ inválido: 11.111.111/1111-11")
    assert not any(f.entity_type == EntityType.CNPJ for f in r.findings)


# ─── Scanner: RG ──────────────────────────────────────────────────────────────

def test_rg_detectado():
    r = scan("RG: 12.345.678-9")
    assert any(f.entity_type == EntityType.RG for f in r.findings)
    assert "[RG]" in r.masked_content


def test_rg_poucos_digitos_nao_detectado():
    # Menos de 7 dígitos — não é RG
    r = scan("código 12-3")
    assert not any(f.entity_type == EntityType.RG for f in r.findings)


# ─── Scanner: PIS/PASEP ───────────────────────────────────────────────────────

def test_pis_valido():
    # PIS 11 dígitos com dígito verificador válido: 120.74321.85-8
    r = scan("PIS do funcionário: 120.74321.85-8")
    assert any(f.entity_type == EntityType.PIS_PASEP for f in r.findings)


# ─── Scanner: Título de Eleitor ───────────────────────────────────────────────

def test_titulo_eleitor():
    r = scan("Título de eleitor: 123456789012")
    assert any(f.entity_type == EntityType.TITULO_ELEITOR for f in r.findings)


# ─── Scanner: Cartão de Crédito (Luhn) ───────────────────────────────────────

def test_cartao_luhn_valido():
    # Número Visa de teste — Luhn válido
    r = scan("Cartão: 4111 1111 1111 1111")
    assert any(f.entity_type == EntityType.CREDIT_CARD for f in r.findings)
    assert "[CARTAO]" in r.masked_content


def test_cartao_luhn_invalido():
    r = scan("número: 4111 1111 1111 1112")
    assert not any(f.entity_type == EntityType.CREDIT_CARD for f in r.findings)


# ─── Scanner: Email ───────────────────────────────────────────────────────────

def test_email_detectado():
    r = scan("Entre em contato: usuario@exemplo.com.br")
    assert any(f.entity_type == EntityType.EMAIL for f in r.findings)
    assert "[EMAIL]" in r.masked_content


def test_email_invalido_nao_detectado():
    r = scan("isso não é email: usuario@")
    assert not any(f.entity_type == EntityType.EMAIL for f in r.findings)


# ─── Scanner: Telefone ────────────────────────────────────────────────────────

def test_telefone_com_ddd():
    r = scan("Ligue: (11) 98765-4321")
    assert any(f.entity_type == EntityType.PHONE for f in r.findings)
    assert "[TELEFONE]" in r.masked_content


# ─── Scanner: Processo CNJ ────────────────────────────────────────────────────

def test_processo_cnj_detectado():
    r = scan("Processo nº 0001234-56.2023.8.26.0100")
    assert any(f.entity_type == EntityType.PROCESS_NUMBER for f in r.findings)
    assert "[PROCESSO_JUDICIAL]" in r.masked_content


def test_processo_cnj_formato_errado_nao_detectado():
    r = scan("número 12345-2023 qualquer")
    assert not any(f.entity_type == EntityType.PROCESS_NUMBER for f in r.findings)


# ─── Scanner: API Key ─────────────────────────────────────────────────────────

def test_api_key_openai():
    r = scan("minha chave: sk-proj-abc123XYZ456abcdefghijklmnopqrst")
    assert any(f.entity_type == EntityType.API_KEY for f in r.findings)
    assert "[API_KEY]" in r.masked_content
    assert r.blocked is True


def test_api_key_generico():
    r = scan("key = sk-abc123XYZ456abcdefghijklmnopqrstuvwx")
    assert any(f.entity_type == EntityType.API_KEY for f in r.findings)


# ─── Scanner: JWT ─────────────────────────────────────────────────────────────

def test_jwt_valido():
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    r = scan(f"token: {jwt}")
    assert any(f.entity_type == EntityType.JWT for f in r.findings)
    assert "[TOKEN]" in r.masked_content
    assert r.blocked is True


def test_jwt_duas_partes_nao_detectado():
    r = scan("not-a-jwt: eyJhbGciOiJIUzI1NiJ9.payload")
    assert not any(f.entity_type == EntityType.JWT for f in r.findings)


# ─── Scanner: SECRET ──────────────────────────────────────────────────────────

def test_secret_assignment():
    r = scan("password=MinhaS3nhaS3creta!")
    assert any(f.entity_type == EntityType.SECRET for f in r.findings)
    assert "[SEGREDO]" in r.masked_content
    assert r.blocked is True


def test_secret_api_secret():
    r = scan("api_secret=xpto_secret_value_12345678")
    assert any(f.entity_type == EntityType.SECRET for f in r.findings)


# ─── Scanner: Endereço ────────────────────────────────────────────────────────

def test_endereco_detectado():
    r = scan("moro na Rua das Flores, n° 123")
    assert any(f.entity_type == EntityType.ADDRESS for f in r.findings)
    assert "[ENDERECO]" in r.masked_content


# ─── Scanner: Placa veicular ──────────────────────────────────────────────────

def test_placa_padrao_antigo():
    r = scan("veículo placa ABC-1234")
    assert any(f.entity_type == EntityType.VEHICLE_PLATE for f in r.findings)
    assert "[PLACA]" in r.masked_content


def test_placa_mercosul():
    r = scan("placa ABC1D23")
    assert any(f.entity_type == EntityType.VEHICLE_PLATE for f in r.findings)


def test_ano_nao_e_placa():
    # Anos não devem ser detectados como placa
    r = scan("em 2023 foi aprovado")
    assert not any(f.entity_type == EntityType.VEHICLE_PLATE for f in r.findings)


# ─── Scanner: Contexto jurídico e médico ──────────────────────────────────────

def test_contexto_juridico():
    r = scan("O réu foi condenado na vara criminal")
    assert any(f.entity_type == EntityType.LEGAL_CONTEXT for f in r.findings)


def test_contexto_medico():
    r = scan("CRM/SP 12345 prescreveu tratamento")
    assert any(f.entity_type == EntityType.MEDICAL_DATA for f in r.findings)


# ─── Scanner: Falso positivo ──────────────────────────────────────────────────

def test_texto_limpo_sem_findings():
    r = scan("Preciso de ajuda para escrever um texto sobre tecnologia.")
    assert len(r.findings) == 0
    assert r.risk_level == RiskLevel.NONE
    assert r.blocked is False


def test_texto_vazio():
    r = scan("")
    assert len(r.findings) == 0
    assert r.blocked is False


# ─── Classification mapping ───────────────────────────────────────────────────

def test_classification_none_to_public():
    assert resolve_classification(RiskLevel.NONE) == ClassificationLevel.PUBLIC


def test_classification_low_to_internal():
    assert resolve_classification(RiskLevel.LOW) == ClassificationLevel.INTERNAL


def test_classification_medium_to_internal():
    assert resolve_classification(RiskLevel.MEDIUM) == ClassificationLevel.INTERNAL


def test_classification_high_to_restricted():
    assert resolve_classification(RiskLevel.HIGH) == ClassificationLevel.RESTRICTED


def test_classification_critical_to_confidential():
    assert resolve_classification(RiskLevel.CRITICAL) == ClassificationLevel.CONFIDENTIAL


def test_classification_unknown_to_internal():
    # UNKNOWN → internal conservador (não tratar como NONE)
    assert resolve_classification(RiskLevel.UNKNOWN) == ClassificationLevel.INTERNAL


def test_show_warning_restricted():
    assert show_warning(ClassificationLevel.RESTRICTED) is True


def test_show_warning_public():
    assert show_warning(ClassificationLevel.PUBLIC) is False


# ─── Governance matrix ────────────────────────────────────────────────────────

def test_governance_restricted_retention():
    g = get_governance(ClassificationLevel.RESTRICTED)
    assert g.retention_days == 90


def test_governance_confidential_retention():
    g = get_governance(ClassificationLevel.CONFIDENTIAL)
    assert g.retention_days == 30


def test_governance_secret_retention():
    g = get_governance(ClassificationLevel.SECRET)
    assert g.retention_days == 7


def test_governance_public_retention():
    g = get_governance(ClassificationLevel.PUBLIC)
    assert g.retention_days == 365


def test_governance_secret_local_only():
    g = get_governance(ClassificationLevel.SECRET)
    assert g.model_constraint == ModelConstraint.LOCAL_ONLY


def test_governance_public_no_warning():
    g = get_governance(ClassificationLevel.PUBLIC)
    assert g.show_warning is False


def test_governance_confidential_warning():
    g = get_governance(ClassificationLevel.CONFIDENTIAL)
    assert g.show_warning is True


def test_provider_allowed_public():
    assert provider_allowed(ClassificationLevel.PUBLIC, "api.openai.com") is True


def test_provider_blocked_secret():
    assert provider_allowed(ClassificationLevel.SECRET, "api.openai.com") is False


# ─── Audit policy ─────────────────────────────────────────────────────────────

def test_audit_record_prompt_always_false():
    config = resolve_audit_config(ClassificationLevel.PUBLIC, False, [], "corr-id-1")
    assert config.record_prompt is False


def test_audit_record_masked_prompt_always_true():
    config = resolve_audit_config(ClassificationLevel.RESTRICTED, True, [], "corr-id-2")
    assert config.record_masked_prompt is True


def test_audit_record_response_false_when_blocked():
    config = resolve_audit_config(ClassificationLevel.CONFIDENTIAL, True, [], "corr-id-3")
    assert config.record_response is False


def test_audit_retention_restricted():
    config = resolve_audit_config(ClassificationLevel.RESTRICTED, False, [], "corr-id-4")
    assert config.retention_days == 90


def test_audit_correlation_id_generated():
    config = resolve_audit_config(ClassificationLevel.PUBLIC, False, [])
    assert len(config.correlation_id) == 36  # UUID4 format


def test_audit_full_level_confidential():
    config = resolve_audit_config(ClassificationLevel.CONFIDENTIAL, False, [], "corr-id-5")
    assert config.audit_level == AuditLevel.FULL


# ─── Hash chain ───────────────────────────────────────────────────────────────

def test_hash_chain_deterministic():
    evt = build_event(
        user_id="u1", correlation_id="c1", event_name="dlp_high_detected",
        classification_level="restricted", dlp_findings_count=2,
        model="gpt-4.1-nano", retention_days=90,
    )
    h1 = compute_hash(GENESIS_HASH, evt)
    h2 = compute_hash(GENESIS_HASH, evt)
    assert h1 == h2


def test_hash_chain_prev_hash_changes_result():
    evt = build_event(
        user_id="u1", correlation_id="c1", event_name="dlp_high_detected",
        classification_level="restricted",
    )
    h1 = compute_hash(GENESIS_HASH, evt)
    h2 = compute_hash("a" * 64, evt)
    assert h1 != h2


def test_hash_chain_genesis_is_zeros():
    assert GENESIS_HASH == "0" * 64


def test_hash_chain_invalid_event_raises():
    with pytest.raises(ValueError, match="Evento inválido"):
        build_event(
            user_id="u1", correlation_id="c1", event_name="evento_inexistente",
            classification_level="public",
        )


def test_hash_chain_verify_integrity():
    evt1 = build_event(
        user_id="u1", correlation_id="c1", event_name="dlp_high_detected",
        classification_level="restricted",
    )
    h1 = compute_hash(GENESIS_HASH, evt1)
    evt1_stored = {**evt1, "hash": h1, "prev_hash": GENESIS_HASH}

    evt2 = build_event(
        user_id="u1", correlation_id="c2", event_name="payload_sent_to_provider",
        classification_level="internal",
    )
    h2 = compute_hash(h1, evt2)
    evt2_stored = {**evt2, "hash": h2, "prev_hash": h1}

    assert verify_chain([evt1_stored, evt2_stored]) is True


def test_hash_chain_detect_tampering():
    evt = build_event(
        user_id="u1", correlation_id="c1", event_name="dlp_critical_blocked",
        classification_level="confidential",
    )
    h = compute_hash(GENESIS_HASH, evt)
    # Adultera o hash armazenado
    evt_tampered = {**evt, "hash": "0" * 64}
    assert verify_chain([evt_tampered]) is False


def test_hash_chain_valid_events_set():
    assert "dlp_high_detected" in VALID_EVENTS
    assert "dlp_critical_blocked" in VALID_EVENTS
    assert "payload_sent_to_provider" in VALID_EVENTS
    assert "user_export_requested" in VALID_EVENTS
    assert "strict_mode_applied" in VALID_EVENTS


# ─── Outbound security ────────────────────────────────────────────────────────

def test_outbound_openai_autorizado():
    assert_safe_llm_url("https://api.openai.com/v1/chat/completions")  # não lança


def test_outbound_gemini_autorizado():
    assert_safe_llm_url("https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent")


def test_outbound_anthropic_autorizado():
    assert_safe_llm_url("https://api.anthropic.com/v1/messages")


def test_outbound_url_nao_autorizada():
    with pytest.raises(ValueError, match="não autorizado"):
        assert_safe_llm_url("https://evil.example.com/steal")


def test_outbound_http_rejeitado():
    with pytest.raises(ValueError, match="HTTPS"):
        assert_safe_llm_url("http://api.openai.com/v1/chat/completions")


def test_outbound_url_vazia():
    with pytest.raises(ValueError):
        assert_safe_llm_url("")


def test_outbound_is_safe_bool():
    assert is_safe_llm_url("https://api.openai.com/v1/chat") is True
    assert is_safe_llm_url("https://malicious.com/api") is False


# ─── Policy: integração ───────────────────────────────────────────────────────

def test_policy_api_key_blocked():
    result = evaluate("minha key: sk-proj-abc123XYZ456abcdefghijklmnopqrst")
    assert result.blocked is True
    assert result.block_reason is not None


def test_policy_cpf_strict_mode_masked():
    result = evaluate("CPF: 050.423.674-11", strict_mode=True)
    assert result.blocked is False
    assert "[CPF]" in result.masked_text


def test_policy_cpf_no_strict_alert_only():
    result = evaluate("CPF: 050.423.674-11", strict_mode=False)
    assert result.blocked is False


def test_policy_unknown_not_treated_as_none():
    # UNKNOWN deve entrar em telemetria, não ser ignorado
    assert RiskLevel.UNKNOWN != RiskLevel.NONE
    assert resolve_classification(RiskLevel.UNKNOWN) != ClassificationLevel.PUBLIC


def test_policy_texto_limpo():
    result = evaluate("Preciso de ajuda com Python.")
    assert result.blocked is False
    assert result.max_risk == RiskLevel.NONE
    assert result.classification_level == ClassificationLevel.PUBLIC


# ─── Placeholders canônicos ───────────────────────────────────────────────────

def test_placeholder_cpf():
    assert PLACEHOLDERS[EntityType.CPF] == "[CPF]"


def test_placeholder_api_key():
    assert PLACEHOLDERS[EntityType.API_KEY] == "[API_KEY]"


def test_placeholder_jwt():
    assert PLACEHOLDERS[EntityType.JWT] == "[TOKEN]"


def test_placeholder_processo():
    assert PLACEHOLDERS[EntityType.PROCESS_NUMBER] == "[PROCESSO_JUDICIAL]"


def test_placeholder_secret():
    assert PLACEHOLDERS[EntityType.SECRET] == "[SEGREDO]"


def test_all_entity_types_have_placeholder():
    for entity in EntityType:
        assert entity in PLACEHOLDERS, f"EntityType.{entity.name} sem placeholder canônico"
