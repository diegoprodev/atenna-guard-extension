"""
Tests for Shared DLP Engine (TASK 4 — Server-side Revalidation)

Validates:
1. Protected token detection ([CPF], [EMAIL], etc)
2. Mismatch detection (client vs server divergence)
3. Revalidation flow
4. No HTTP internal calls (everything in-process)
"""

import pytest
import sys
from unittest.mock import patch, MagicMock

# Mock Presidio before engine import
presidio_mock = MagicMock()
presidio_mock.nlp_engine = MagicMock()
sys.modules["presidio_analyzer"] = presidio_mock
sys.modules["presidio_analyzer.nlp_engine"] = presidio_mock.nlp_engine

from dlp.engine import (
    DLPEngine,
    AnalysisResult,
    MismatchReport,
    get_engine,
    analyze,
    revalidate,
)


class TestProtectedTokenDetection:
    """Testa detecção de tokens protegidos."""

    def test_detects_cpf_token(self):
        """Detecta [CPF]."""
        engine = DLPEngine()
        assert engine._detect_protected_tokens("Meu [CPF]") is True
        assert engine._detect_protected_tokens("Meu CPF é...") is False

    def test_detects_email_token(self):
        """Detecta [EMAIL]."""
        engine = DLPEngine()
        assert engine._detect_protected_tokens("Contato [EMAIL]") is True

    def test_detects_api_key_token(self):
        """Detecta [CHAVE_API]."""
        engine = DLPEngine()
        assert engine._detect_protected_tokens("Key: [CHAVE_API]") is True

    def test_detects_multiple_tokens(self):
        """Detecta múltiplos tokens."""
        engine = DLPEngine()
        text = "Nome [NOME], CPF [CPF], Email [EMAIL]"
        assert engine._detect_protected_tokens(text) is True

    def test_case_insensitive(self):
        """Case-insensitive detection."""
        engine = DLPEngine()
        assert engine._detect_protected_tokens("[cpf]") is True
        assert engine._detect_protected_tokens("[CpF]") is True


class TestMismatchDetection:
    """Testa detecção de divergência client vs server."""

    def test_client_low_server_high_detected(self):
        """CLIENT LOW + SERVER HIGH = mismatch com HIGH confidence."""
        engine = DLPEngine()
        client_meta = {
            "dlp_risk_level": "LOW",
            "dlp_entity_count": 1,
            "dlp_entity_types": ["EMAIL"],
        }

        # Mock server result
        server_result = MagicMock()
        server_result.risk_level = "HIGH"
        server_result.entities = [MagicMock(), MagicMock()]

        mismatch = engine._compare_findings(client_meta, server_result)

        assert mismatch.has_mismatch is True
        assert mismatch.divergence_type == "client_low_server_high"
        assert mismatch.client_risk == "LOW"
        assert mismatch.server_risk == "HIGH"
        assert mismatch.confidence > 0.5  # Gap is significant

    def test_client_none_server_high(self):
        """CLIENT NONE + SERVER HIGH = HIGH confidence mismatch."""
        engine = DLPEngine()
        client_meta = {
            "dlp_risk_level": "NONE",
            "dlp_entity_count": 0,
        }

        server_result = MagicMock()
        server_result.risk_level = "HIGH"
        server_result.entities = [MagicMock()]

        mismatch = engine._compare_findings(client_meta, server_result)

        assert mismatch.has_mismatch is True
        assert mismatch.divergence_type == "client_low_server_high"
        assert mismatch.confidence >= 0.9  # Maximum gap

    def test_client_high_server_low_detected(self):
        """CLIENT HIGH + SERVER LOW = LOW confidence mismatch (client overestimate)."""
        engine = DLPEngine()
        client_meta = {
            "dlp_risk_level": "HIGH",
            "dlp_entity_count": 2,
        }

        server_result = MagicMock()
        server_result.risk_level = "MEDIUM"
        server_result.entities = [MagicMock()]

        mismatch = engine._compare_findings(client_meta, server_result)

        assert mismatch.has_mismatch is True
        assert mismatch.divergence_type == "client_high_server_low"
        assert mismatch.confidence == 0.5  # Lower confidence

    def test_entity_count_mismatch(self):
        """Sama risk but different entity counts."""
        engine = DLPEngine()
        client_meta = {
            "dlp_risk_level": "MEDIUM",
            "dlp_entity_count": 1,
        }

        server_result = MagicMock()
        server_result.risk_level = "MEDIUM"
        server_result.entities = [MagicMock(), MagicMock(), MagicMock()]

        mismatch = engine._compare_findings(client_meta, server_result)

        assert mismatch.has_mismatch is True
        assert mismatch.divergence_type == "entity_count_mismatch"
        assert mismatch.client_entity_count == 1
        assert mismatch.server_entity_count == 3

    def test_no_mismatch_identical_findings(self):
        """Sem mismatch quando findings são idênticos."""
        engine = DLPEngine()
        client_meta = {
            "dlp_risk_level": "HIGH",
            "dlp_entity_count": 1,
        }

        server_result = MagicMock()
        server_result.risk_level = "HIGH"
        server_result.entities = [MagicMock()]

        mismatch = engine._compare_findings(client_meta, server_result)

        assert mismatch.has_mismatch is False
        assert mismatch.divergence_type is None


class TestRevalidationFlow:
    """Testa fluxo completo de revalidação."""

    def test_revalidate_returns_analysis_and_mismatch(self):
        """Revalidate retorna tupla (analysis, mismatch)."""
        engine = DLPEngine()
        client_meta = {"dlp_risk_level": "NONE"}

        with patch("dlp.engine.analyze") as mock_analyze:
            mock_analyze.return_value = []  # No entities found

            with patch("dlp.engine.score_results") as mock_score:
                mock_score.return_value = (0, "NONE")

                analysis, mismatch = engine.revalidate(
                    "Normal text",
                    client_meta,
                )

                assert isinstance(analysis, AnalysisResult)
                assert isinstance(mismatch, MismatchReport)

    def test_protected_tokens_set_was_rewritten(self):
        """Detecta que payload foi reescrito."""
        engine = DLPEngine()

        with patch("dlp.engine.analyze") as mock_analyze:
            mock_analyze.return_value = []

            with patch("dlp.engine.score_results") as mock_score:
                mock_score.return_value = (0, "NONE")

                analysis = engine.analyze("[CPF] e [EMAIL]")

                assert analysis.protected_tokens_detected is True
                assert analysis.was_rewritten is True


class TestGlobalEngineInstance:
    """Testa instância global do engine."""

    def test_get_engine_returns_singleton(self):
        """get_engine retorna mesma instância sempre."""
        engine1 = get_engine()
        engine2 = get_engine()
        assert engine1 is engine2

    def test_convenience_functions_use_global_engine(self):
        """Funções de conveniência usam engine global."""
        # Should not raise
        with patch("dlp.engine.DLPEngine.analyze") as mock_analyze:
            mock_analyze.return_value = AnalysisResult(
                risk_level="NONE",
                score=0,
                entities=[],
                entity_types=[],
                duration_ms=10,
                source="test",
                text_hash="abc123",
                protected_tokens_detected=False,
                was_rewritten=False,
            )

            result = analyze("test")
            assert result.risk_level == "NONE"


class TestNoHTTPInternalCalls:
    """
    Valida que NÃO existem chamadas HTTP internas.

    O engine é compartilhado:
    - /dlp/scan usa engine.analyze()
    - /generate-prompts usa engine.revalidate()

    SEM engine.analyze() → HTTP → /dlp/scan
    """

    def test_engine_is_in_process(self):
        """Engine é chamado in-process, não via HTTP."""
        engine = DLPEngine()
        # Verifica que engine é um objeto Python, não um cliente HTTP
        assert hasattr(engine, "analyze")
        assert hasattr(engine, "revalidate")
        assert callable(engine.analyze)
        assert callable(engine.revalidate)

    def test_no_requests_import_in_engine(self):
        """Engine não importa 'requests' ou similar."""
        import dlp.engine as engine_module
        source = open(engine_module.__file__).read()
        # Verifica que não há import de HTTP client
        assert "import requests" not in source
        assert "from requests" not in source
        assert "httpx" not in source
        assert "aiohttp" not in source


class TestTextHashing:
    """Testa hashing de texto para mismatch tracking."""

    def test_same_text_same_hash(self):
        """Mesmo texto → mesmo hash."""
        engine = DLPEngine()
        hash1 = engine._hash_text("Meu CPF 050.423.674-11")
        hash2 = engine._hash_text("Meu CPF 050.423.674-11")
        assert hash1 == hash2

    def test_different_text_different_hash(self):
        """Texto diferente → hash diferente."""
        engine = DLPEngine()
        hash1 = engine._hash_text("CPF A")
        hash2 = engine._hash_text("CPF B")
        assert hash1 != hash2

    def test_hash_length(self):
        """Hash tem 8 caracteres."""
        engine = DLPEngine()
        hash_val = engine._hash_text("test")
        assert len(hash_val) == 8


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
