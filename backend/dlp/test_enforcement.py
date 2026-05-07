"""
Testes unitários para Strict Mode Enforcement

Validam:
1. STRICT_DLP_MODE=false com HIGH risk → sem rewrite, apenas observação
2. STRICT_DLP_MODE=true com HIGH risk → rewrite aplicado
3. STRICT_DLP_MODE=true com LOW risk → sem rewrite
4. Compatibilidade com requests sem DLP metadata
"""

import os
import sys
import pytest
from unittest.mock import patch, MagicMock, Mock

# Mock Presidio modules BEFORE any local imports
presidio_mock = MagicMock()
presidio_mock.nlp_engine = MagicMock()
presidio_mock.nlp_engine.NlpEngineProvider = MagicMock()
sys.modules["presidio_analyzer"] = presidio_mock
sys.modules["presidio_analyzer.nlp_engine"] = presidio_mock.nlp_engine
sys.modules["presidio_anonymizer"] = MagicMock()

# Agora importa enforcement
from dlp.enforcement import (
    is_strict_mode_enabled,
    should_apply_strict_enforcement,
    evaluate_strict_enforcement,
    rewrite_pii_tokens,
)


class TestStrictModeConfiguration:
    """Testa leitura da configuração STRICT_DLP_MODE."""

    def test_strict_mode_disabled_by_default(self):
        """Padrão: strict mode desligado."""
        with patch.dict(os.environ, {}, clear=True):
            assert is_strict_mode_enabled() is False

    def test_strict_mode_enabled_when_set_true(self):
        """Ativado quando STRICT_DLP_MODE=true."""
        with patch.dict(os.environ, {"STRICT_DLP_MODE": "true"}):
            assert is_strict_mode_enabled() is True

    def test_strict_mode_case_insensitive(self):
        """Case-insensitive: 'TRUE', 'True' também funcionam."""
        with patch.dict(os.environ, {"STRICT_DLP_MODE": "TRUE"}):
            assert is_strict_mode_enabled() is True

        with patch.dict(os.environ, {"STRICT_DLP_MODE": "False"}):
            assert is_strict_mode_enabled() is False


class TestEnforcementDecision:
    """Testa lógica de decisão de enforcement."""

    def test_high_risk_should_apply(self):
        """HIGH risk deve ativar enforcement (quando strict mode está ligado)."""
        with patch.dict(os.environ, {"STRICT_DLP_MODE": "true"}):
            assert should_apply_strict_enforcement("HIGH") is True

    def test_medium_risk_should_not_apply(self):
        """MEDIUM risk não deve ativar enforcement."""
        assert should_apply_strict_enforcement("MEDIUM") is False

    def test_low_risk_should_not_apply(self):
        """LOW risk não deve ativar enforcement."""
        assert should_apply_strict_enforcement("LOW") is False

    def test_none_risk_should_not_apply(self):
        """NONE risk não deve ativar enforcement."""
        assert should_apply_strict_enforcement("NONE") is False


class TestPIIRewriting:
    """Testa reescrita de PII com tokens."""

    def test_rewrite_cpf(self):
        """Reescreve CPF com token [CPF]."""
        text = "Meu CPF é 050.423.674-11"
        entities = [
            {"type": "BR_CPF", "start": 10, "end": 24}
        ]
        result = rewrite_pii_tokens(text, entities)
        assert "[CPF]" in result
        assert "050.423.674-11" not in result

    def test_rewrite_email(self):
        """Reescreve email com token [EMAIL]."""
        text = "Contato: diego@example.com"
        entities = [
            {"type": "EMAIL_ADDRESS", "start": 9, "end": 27}
        ]
        result = rewrite_pii_tokens(text, entities)
        assert "[EMAIL]" in result
        assert "diego@example.com" not in result

    def test_rewrite_multiple_entities(self):
        """Reescreve múltiplas entidades."""
        text = "CPF 050.423.674-11 e email diego@example.com"
        entities = [
            {"type": "BR_CPF", "start": 4, "end": 18},
            {"type": "EMAIL_ADDRESS", "start": 28, "end": 46},
        ]
        result = rewrite_pii_tokens(text, entities)
        assert "[CPF]" in result
        assert "[EMAIL]" in result
        assert "050.423.674-11" not in result
        assert "diego@example.com" not in result

    def test_rewrite_api_key(self):
        """Reescreve chave de API."""
        text = "Api key: sk-abc123xyz789"
        entities = [
            {"type": "API_KEY", "start": 9, "end": 24}
        ]
        result = rewrite_pii_tokens(text, entities)
        assert "[CHAVE_API]" in result
        assert "sk-abc123xyz789" not in result

    def test_rewrite_empty_entities(self):
        """Não faz nada com entidades vazias."""
        text = "Texto sem sensível"
        entities = []
        result = rewrite_pii_tokens(text, entities)
        assert result == text


class TestStrictEnforcement:
    """Testa fluxo completo de enforcement."""

    def test_strict_mode_false_high_risk_observes_only(self):
        """STRICT_DLP_MODE=false com HIGH risk: apenas observa, não reescreve."""
        with patch.dict(os.environ, {"STRICT_DLP_MODE": "false"}):
            dlp_meta = {
                "dlp_risk_level": "HIGH",
                "dlp_entity_count": 1,
                "dlp_entity_types": ["BR_CPF"],
            }
            result = evaluate_strict_enforcement(
                "CPF 050.423.674-11",
                dlp_meta,
            )
            # Não deve reescrever em modo observação
            assert result["applied"] is False
            assert result["rewritten_text"] == "CPF 050.423.674-11"
            assert result["would_apply"] is True  # Mas registra que TERIA aplicado

    def test_strict_mode_true_high_risk_rewrites(self):
        """STRICT_DLP_MODE=true com HIGH risk: reescreve."""
        with patch.dict(os.environ, {"STRICT_DLP_MODE": "true"}):
            with patch("dlp.enforcement.dlp_analyze") as mock_analyze:
                # Mock retorna análise de HIGH risk com CPF
                mock_analyze.return_value = MagicMock(
                    risk_level="HIGH",
                    entities=[
                        {"type": "BR_CPF", "value": "050.423.674-11", "start": 4, "end": 18}
                    ],
                )
                dlp_meta = {
                    "dlp_risk_level": "HIGH",
                    "dlp_entity_count": 1,
                    "dlp_entity_types": ["BR_CPF"],
                }
                result = evaluate_strict_enforcement(
                    "CPF 050.423.674-11",
                    dlp_meta,
                )
                # Deve reescrever
                assert result["applied"] is True
                assert result["sanitized"] is True
                assert "[CPF]" in result["rewritten_text"]
                assert "050.423.674-11" not in result["rewritten_text"]

    def test_strict_mode_true_low_risk_no_rewrite(self):
        """STRICT_DLP_MODE=true com LOW risk: não reescreve."""
        with patch.dict(os.environ, {"STRICT_DLP_MODE": "true"}):
            dlp_meta = {
                "dlp_risk_level": "LOW",
                "dlp_entity_count": 0,
                "dlp_entity_types": [],
            }
            result = evaluate_strict_enforcement(
                "Este é um texto técnico normal",
                dlp_meta,
            )
            # Não deve reescrever LOW risk
            assert result["applied"] is False
            assert result["rewritten_text"] == "Este é um texto técnico normal"

    def test_request_without_dlp_metadata(self):
        """Request sem DLP metadata é compatível."""
        with patch.dict(os.environ, {"STRICT_DLP_MODE": "false"}):
            result = evaluate_strict_enforcement(
                "Texto normal",
                {},  # metadata vazia
            )
            # Deve retornar texto original sem erros
            assert result["rewritten_text"] == "Texto normal"
            assert result["applied"] is False


class TestLogging:
    """Testa registro estruturado de eventos."""

    def test_logs_are_json(self, capsys):
        """Eventos são registrados como JSON."""
        with patch.dict(os.environ, {"STRICT_DLP_MODE": "false"}):
            dlp_meta = {"dlp_risk_level": "HIGH", "dlp_entity_types": ["BR_CPF"]}
            evaluate_strict_enforcement("CPF 050.423.674-11", dlp_meta)

            captured = capsys.readouterr()
            assert "dlp_strict_would_apply" in captured.out
            # Verifica que é JSON válido
            import json
            log_line = [l for l in captured.out.split('\n') if 'dlp_strict' in l][0]
            parsed = json.loads(log_line)
            assert parsed["event"] == "dlp_strict_would_apply"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
