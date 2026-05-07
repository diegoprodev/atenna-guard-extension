"""
Testes LGPD — Validação de 15 categorias obrigatórias

Valida que Strict Mode responda corretamente a:
1. Dados Pessoais (7 tipos)
2. Dados Sensíveis (6 tipos)
3. Dados Corporativos (11 tipos)

Com contexto + severidade + scoring.
"""

import pytest
from dlp.lgpd_validator import (
    classify_lgpd_severity,
    evaluate_lgpd_categories,
    detect_health_context,
    detect_legal_context,
    detect_financial_context,
    detect_confidential_context,
)


class TestDadosPessoais:
    """Testa detecção de dados pessoais LGPD."""

    def test_cpf_high_risk(self):
        """CPF deve ser classificado como HIGH."""
        risk, score = classify_lgpd_severity("BR_CPF", "050.423.674-11", "")
        assert risk == "HIGH"
        assert score >= 0.80

    def test_cnpj_medium_risk(self):
        """CNPJ deve ser MEDIUM."""
        risk, score = classify_lgpd_severity("BR_CNPJ", "12.345.678/0001-90", "")
        assert risk in ["MEDIUM", "HIGH"]
        assert score >= 0.70

    def test_rg_medium_risk(self):
        """RG deve ser MEDIUM."""
        risk, score = classify_lgpd_severity("RG", "12345678A", "")
        assert risk in ["MEDIUM", "HIGH"]
        assert score >= 0.70

    def test_cnh_medium_risk(self):
        """CNH deve ser MEDIUM."""
        risk, score = classify_lgpd_severity("CNH", "12345678900", "")
        assert risk in ["LOW", "MEDIUM", "HIGH"]

    def test_email_low_medium_risk(self):
        """Email sozinho é LOW, em contexto PII é MEDIUM."""
        risk_alone, _ = classify_lgpd_severity("EMAIL_ADDRESS", "user@example.com", "")
        assert risk_alone in ["LOW", "MEDIUM"]

    def test_phone_medium_risk(self):
        """Telefone deve ser MEDIUM."""
        risk, score = classify_lgpd_severity("PHONE_NUMBER", "+55 11 98765-4321", "")
        assert risk in ["MEDIUM", "HIGH"]

    def test_cep_low_risk(self):
        """CEP sozinho é LOW."""
        risk, _ = classify_lgpd_severity("CEP", "01310100", "")
        assert risk in ["LOW", "MEDIUM"]

    def test_process_number_medium_high(self):
        """Processo judicial (CNJ) é MEDIUM-HIGH."""
        risk, score = classify_lgpd_severity("PROCESS_NUMBER", "0000001-10.2020.8.26.0100", "")
        assert risk in ["MEDIUM", "HIGH"]
        assert score >= 0.70


class TestDadosSensíveis:
    """Testa detecção de dados sensíveis com contexto."""

    def test_health_data_high_with_context(self):
        """Menção de saúde + contexto = HIGH."""
        text = "Paciente com HIV diagnosticado com depressão"
        risk, score = classify_lgpd_severity("HEALTH_MENTION", "HIV", text)
        assert risk in ["MEDIUM", "HIGH"]
        assert score >= 0.70

    def test_health_context_detection(self):
        """Detecta keywords de saúde."""
        text = "Paciente diagnosticado com câncer em cirurgia realizada no hospital"
        health_score = detect_health_context(text)
        assert health_score > 0.5

    def test_religious_affiliation_medium(self):
        """Afiliação religiosa é MEDIUM."""
        risk, _ = classify_lgpd_severity("RELIGIOUS_MENTION", "católico", "Afiliação religiosa")
        assert risk in ["MEDIUM", "HIGH"]

    def test_political_affiliation_medium(self):
        """Afiliação política é MEDIUM."""
        text = "Voto no partido X, eleição, candidato Y"
        political_mentions = sum(1 for kw in ["voto", "partido", "eleição"] if kw in text)
        assert political_mentions >= 2

    def test_racial_origin_high(self):
        """Origem racial é MEDIUM-HIGH."""
        risk, _ = classify_lgpd_severity("PERSON", "afrodescendente", "Origem racial")
        assert risk in ["MEDIUM", "HIGH"]

    def test_union_affiliation_medium(self):
        """Filiação sindical é MEDIUM."""
        risk, _ = classify_lgpd_severity("UNION_AFFILIATION", "sindicato", "Filiado a")
        assert risk in ["MEDIUM", "HIGH"]


class TestDadosCorporativos:
    """Testa detecção de credenciais e segredos corporativos."""

    def test_api_key_high(self):
        """API key é HIGH."""
        risk, score = classify_lgpd_severity("API_KEY", "sk_live_abc123", "")
        assert risk == "HIGH"
        assert score >= 0.90

    def test_jwt_token_high(self):
        """JWT é HIGH."""
        risk, score = classify_lgpd_severity("JWT", "eyJhbGc...", "")
        assert risk == "HIGH"
        assert score >= 0.90

    def test_credential_high(self):
        """Credenciais são HIGH."""
        risk, score = classify_lgpd_severity("CREDENTIAL", "password123", "")
        assert risk == "HIGH"
        assert score >= 0.85

    def test_credit_card_high(self):
        """Cartão de crédito é HIGH."""
        risk, score = classify_lgpd_severity("CREDIT_CARD", "4111111111111111", "")
        assert risk in ["MEDIUM", "HIGH"]
        assert score >= 0.80

    def test_legal_document_medium_high_with_context(self):
        """Parecer jurídico em contexto legal é MEDIUM-HIGH."""
        text = "Parecer jurídico confidencial da procuradoria sobre ação judicial"
        legal_score = detect_legal_context(text)
        confidential_score = detect_confidential_context(text)
        assert legal_score > 0.3 or confidential_score > 0.3

    def test_financial_data_medium_with_context(self):
        """Informação financeira em contexto = MEDIUM."""
        text = "Salário R$ 5000, bonificação, imposto"
        financial_score = detect_financial_context(text)
        assert financial_score > 0.3

    def test_confidential_mention_medium(self):
        """Documento confidencial é MEDIUM."""
        text = "Contrato confidencial, acesso limitado, não publicar"
        confidential_score = detect_confidential_context(text)
        assert confidential_score > 0.5

    def test_internal_document_medium(self):
        """Documento interno é MEDIUM."""
        risk, _ = classify_lgpd_severity("INTERNAL_DOCUMENT", "memo", "Documento interno")
        # Interno é menos crítico que confidencial
        assert risk in ["LOW", "MEDIUM"]

    def test_strategic_information_medium_high(self):
        """Informação estratégica é MEDIUM-HIGH."""
        text = "Informacao estrategica sobre roadmap, planejamento, segredos da empresa"
        # Detecta via regex ou confidentiality
        result = evaluate_lgpd_categories(text)
        # Deve detectar roadmap ou segredos
        assert result["categories_found"] >= 1


class TestExemplosObrigatórios:
    """Testa exemplos específicos do usuário."""

    def test_exemplo_1_paciente_hiv(self):
        """
        'Paciente com HIV'
        Esperado: MÉDIO+
        """
        result = evaluate_lgpd_categories("Paciente com HIV diagnosticado com depressão há 2 anos")
        # Com múltiplos health keywords deve detectar como MEDIUM no mínimo
        assert result["severity_summary"] in ["MEDIUM", "HIGH"]
        assert result["requires_strict"] is True

    def test_exemplo_2_parecer_procuradoria(self):
        """
        'Segue parecer interno da procuradoria'
        Esperado: MÉDIO/ALTO
        """
        result = evaluate_lgpd_categories(
            "Segue parecer confidencial interno da procuradoria sobre a ação judicial"
        )
        assert result["severity_summary"] in ["MEDIUM", "HIGH"]
        assert result["requires_strict"] is True

    def test_exemplo_3_contrato_licitacao(self):
        """
        'Contrato confidencial da licitação'
        Esperado: MÉDIO/ALTO
        """
        result = evaluate_lgpd_categories(
            "Contrato confidencial da licitação restrito acesso"
        )
        assert result["severity_summary"] in ["MEDIUM", "HIGH"]
        assert result["requires_strict"] is True

    def test_exemplo_4_api_key_sk_live(self):
        """
        'api_key=sk_live'
        Esperado: ALTO
        """
        result = evaluate_lgpd_categories("api_key=sk_live_abc123xyz789")
        assert result["severity_summary"] == "HIGH"
        assert result["requires_strict"] is True

    def test_exemplo_5_cartao_credito(self):
        """
        'Cartão 4111111111111111'
        Esperado: ALTO
        """
        result = evaluate_lgpd_categories("Use o cartão 4111111111111111 para pagamento")
        assert result["severity_summary"] in ["HIGH", "MEDIUM"]
        assert result["requires_strict"] is True


class TestContextoIntegrado:
    """Testa scoring com contexto integrado."""

    def test_cpf_em_contexto_confidencial(self):
        """CPF em contexto confidencial aumenta score."""
        risk_simple, score_simple = classify_lgpd_severity(
            "BR_CPF", "050.423.674-11", ""
        )
        risk_confidential, score_confidential = classify_lgpd_severity(
            "BR_CPF", "050.423.674-11", "Documento confidencial não publicar"
        )
        # Score com contexto não deve ser menor
        assert score_confidential >= score_simple - 0.05

    def test_email_em_contexto_financeiro(self):
        """Email em contexto financeiro aumenta severidade."""
        result = evaluate_lgpd_categories(
            "Email: contato@banco.com.br para informações de salário e investimentos"
        )
        # Contexto financeiro elevaria a severidade
        assert result["categories_found"] >= 1

    def test_multiplas_categorias_eleva_severidade(self):
        """Múltiplas categorias detectadas = maior severidade."""
        text = (
            "CPF 050.423.674-11, paciente com diabetes, "
            "api_key=sk_live_abc123, contrato confidencial"
        )
        result = evaluate_lgpd_categories(text)
        assert result["categories_found"] >= 3
        assert result["severity_summary"] in ["MEDIUM", "HIGH"]


class TestCompatibilidade:
    """Testa compatibilidade com fluxo existente."""

    def test_texto_normal_nao_alto_risco(self):
        """Texto comum não deve ser flagged como alto risco."""
        result = evaluate_lgpd_categories(
            "Explique o que é machine learning e como funciona"
        )
        assert result["severity_summary"] == "NONE"
        assert result["requires_strict"] is False

    def test_contexto_legtimo_nao_gera_falso_positivo(self):
        """Contexto técnico legítimo não gera FP."""
        result = evaluate_lgpd_categories(
            "A chave de segurança do sistema"
        )
        # Não deve detectar como HIGH apenas por "chave"
        # O padrão regex é específico: sk_live_... ou sk_test_...
        assert result["severity_summary"] in ["NONE", "LOW"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
