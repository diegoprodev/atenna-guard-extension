"""
Tests for TASK 5 — Timeout Safety

Validates:
1. DLP analysis respects 3-second timeout
2. Returns NONE risk on timeout (fail-safe)
3. Returns NONE risk on exception (fail-safe)
4. Telemetry emitted for timeout/error scenarios
"""

import pytest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock

# Mock Presidio before engine import
presidio_mock = MagicMock()
presidio_mock.nlp_engine = MagicMock()
import sys
sys.modules["presidio_analyzer"] = presidio_mock
sys.modules["presidio_analyzer.nlp_engine"] = presidio_mock.nlp_engine

from dlp.engine import DLPEngine, AnalysisResult, ANALYSIS_TIMEOUT_SECONDS
from dlp.pipeline import SCAN_TIMEOUT_SECONDS


class TestAnalyzeTimeout:
    """Tests for analyze() timeout behavior."""

    @pytest.mark.asyncio
    async def test_analyze_timeout_returns_unknown_risk(self):
        """analyze() returns UNKNOWN risk on timeout (not NONE)."""
        engine = DLPEngine()

        # Mock slow analyzer that exceeds timeout
        async def slow_analyze(*args, **kwargs):
            await asyncio.sleep(ANALYSIS_TIMEOUT_SECONDS + 1)
            return []

        with patch("dlp.engine.asyncio.get_event_loop") as mock_loop:
            # Simulate timeout by raising asyncio.TimeoutError
            mock_executor = MagicMock()
            mock_loop.return_value.run_in_executor = MagicMock(
                return_value=slow_analyze()
            )

            # Actually test timeout behavior
            engine_instance = DLPEngine()
            with patch("dlp.engine.analyze") as mock_analyze_fn:
                # Create a coroutine that times out
                async def timeout_coro(*args, **kwargs):
                    await asyncio.sleep(ANALYSIS_TIMEOUT_SECONDS + 1)
                    return []

                # Patch asyncio.wait_for to raise TimeoutError
                with patch("asyncio.wait_for") as mock_wait_for:
                    mock_wait_for.side_effect = asyncio.TimeoutError()

                    result = await engine_instance.analyze("test text")

                    assert result.risk_level == "UNKNOWN"
                    assert result.score == 0
                    assert result.entities == []
                    assert result.protected_tokens_detected is False

    @pytest.mark.asyncio
    async def test_analyze_exception_returns_unknown_risk(self):
        """analyze() returns UNKNOWN risk on any exception (not NONE)."""
        engine = DLPEngine()

        # Mock analyzer that raises exception
        with patch("asyncio.wait_for") as mock_wait_for:
            mock_wait_for.side_effect = RuntimeError("Presidio error")

            result = await engine.analyze("test text")

            assert result.risk_level == "UNKNOWN"
            assert result.score == 0
            assert result.entities == []

    @pytest.mark.asyncio
    async def test_analyze_timeout_emits_telemetry(self):
        """analyze() emits dlp_timeout telemetry on timeout."""
        engine = DLPEngine()

        with patch("asyncio.wait_for") as mock_wait_for:
            mock_wait_for.side_effect = asyncio.TimeoutError()

            with patch("dlp.engine.telemetry.dlp_timeout") as mock_telemetry:
                result = await engine.analyze("test", session_id="session-123")

                mock_telemetry.assert_called_once()
                call_args = mock_telemetry.call_args
                assert call_args[1]["session_id"] == "session-123"
                assert call_args[1]["endpoint"] == "analyze"

    @pytest.mark.asyncio
    async def test_analyze_exception_emits_telemetry(self):
        """analyze() emits dlp_engine_error telemetry on exception."""
        engine = DLPEngine()

        with patch("asyncio.wait_for") as mock_wait_for:
            mock_wait_for.side_effect = ValueError("Test error")

            with patch("dlp.engine.telemetry.dlp_engine_error") as mock_telemetry:
                result = await engine.analyze("test", session_id="session-123")

                mock_telemetry.assert_called_once()
                call_args = mock_telemetry.call_args
                assert call_args[1]["session_id"] == "session-123"
                assert call_args[1]["endpoint"] == "analyze"
                assert call_args[1]["error_type"] == "ValueError"


class TestRevalidateTimeout:
    """Tests for revalidate() timeout behavior."""

    @pytest.mark.asyncio
    async def test_revalidate_timeout_returns_unknown_risk(self):
        """revalidate() returns UNKNOWN risk on timeout (not NONE)."""
        engine = DLPEngine()

        # Mock timeout in analyze() call
        with patch("asyncio.wait_for") as mock_wait_for:
            mock_wait_for.side_effect = asyncio.TimeoutError()

            client_meta = {"dlp_risk_level": "HIGH", "dlp_entity_count": 1}
            analysis, mismatch = await engine.revalidate("test text", client_meta)

            # Server returns UNKNOWN on timeout, client sent HIGH
            assert analysis.risk_level == "UNKNOWN"
            # Mismatch is detected: client_high_server_low (client overestimated due to timeout)
            assert mismatch.has_mismatch is True
            assert mismatch.divergence_type == "client_high_server_low"


class TestScanTimeout:
    """Tests for /scan endpoint timeout behavior."""

    @pytest.mark.asyncio
    async def test_scan_timeout_returns_unknown_risk(self):
        """scan pipeline returns UNKNOWN risk on timeout (not NONE)."""
        from dlp.pipeline import run
        from dlp.entities import ScanRequest

        request = ScanRequest(
            text="test text",
            client_score=0.0,
            session_id="session-123",
            platform="web",
        )

        # Mock timeout in analyzer
        with patch("asyncio.wait_for") as mock_wait_for:
            mock_wait_for.side_effect = asyncio.TimeoutError()

            response = await run(request)

            assert response.risk_level == "UNKNOWN"
            assert response.score == 0
            assert response.entities == []

    @pytest.mark.asyncio
    async def test_scan_exception_returns_unknown_risk(self):
        """scan pipeline returns UNKNOWN risk on exception (not NONE)."""
        from dlp.pipeline import run
        from dlp.entities import ScanRequest

        request = ScanRequest(
            text="test text",
            client_score=0.0,
            session_id="session-123",
            platform="web",
        )

        # Mock exception in analyzer
        with patch("asyncio.wait_for") as mock_wait_for:
            mock_wait_for.side_effect = RuntimeError("Analyzer error")

            response = await run(request)

            assert response.risk_level == "UNKNOWN"
            assert response.score == 0


class TestUnknownRiskLevel:
    """Tests for UNKNOWN risk level semantics."""

    def test_unknown_is_separate_from_none(self):
        """UNKNOWN and NONE are semantically distinct."""
        # NONE = analyzed, no risk
        # UNKNOWN = not analyzed, risk undetermined
        from dlp.entities import RiskLevel

        assert RiskLevel.NONE != RiskLevel.UNKNOWN
        assert RiskLevel.NONE.value == "NONE"
        assert RiskLevel.UNKNOWN.value == "UNKNOWN"

    def test_enforcement_does_not_rewrite_unknown(self):
        """Strict mode does NOT rewrite UNKNOWN risk (conservative)."""
        from dlp.enforcement import evaluate_strict_enforcement
        import os

        with patch.dict(os.environ, {"STRICT_DLP_MODE": "true"}):
            dlp_meta = {
                "dlp_risk_level": "UNKNOWN",
                "dlp_entity_count": 0,
                "dlp_entity_types": [],
            }

            result = evaluate_strict_enforcement(
                "Test text",
                dlp_meta,
                entities=[],
            )

            # UNKNOWN should not trigger rewrite (not actionable)
            assert result["applied"] is False
            assert result["would_apply"] is False
            assert result["rewritten_text"] == "Test text"

    def test_unknown_does_not_assume_safety(self):
        """UNKNOWN risk is not treated as NONE (safe)."""
        from dlp.entities import RiskLevel

        # These should be checked separately in logic
        assert RiskLevel.UNKNOWN.value != RiskLevel.NONE.value
        # Enforcement logic must explicitly check for UNKNOWN


class TestTimeoutConstants:
    """Tests for timeout configuration."""

    def test_analysis_timeout_is_3_seconds(self):
        """ANALYSIS_TIMEOUT_SECONDS is set to 3.0."""
        assert ANALYSIS_TIMEOUT_SECONDS == 3.0

    def test_scan_timeout_is_3_seconds(self):
        """SCAN_TIMEOUT_SECONDS is set to 3.0."""
        assert SCAN_TIMEOUT_SECONDS == 3.0

    def test_timeout_is_reasonable(self):
        """Timeout is between 2 and 5 seconds."""
        assert 2.0 <= ANALYSIS_TIMEOUT_SECONDS <= 5.0
        assert 2.0 <= SCAN_TIMEOUT_SECONDS <= 5.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
