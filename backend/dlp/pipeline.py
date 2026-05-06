"""
DLP pipeline orchestrator — runs full backend analysis and returns a ScanResponse.
Designed to be called from the FastAPI route; raises no exceptions (returns safe default).
"""
from __future__ import annotations

import time

from .entities import RiskLevel, ScanRequest, ScanResponse
from .analyzer import analyze
from .scoring import score_results
from .advisory import build_response
from . import telemetry


def run(request: ScanRequest) -> ScanResponse:
    t0 = time.perf_counter()
    telemetry.scan_started(request.session_id, request.platform)

    try:
        results = analyze(request.text)
        score, risk_level = score_results(
            results,
            client_score=request.client_score,
        )

        # Telemetry for entities
        for r in results:
            telemetry.entity_detected(r.entity_type, risk_level, r.score, request.session_id)
        if risk_level == RiskLevel.HIGH:
            telemetry.high_risk(score, [r.entity_type for r in results], request.session_id)

        duration_ms = (time.perf_counter() - t0) * 1000
        telemetry.scan_complete(duration_ms, risk_level, request.session_id)

        return build_response(risk_level, score, results, request.text, duration_ms)

    except Exception:
        # Never fail the caller — return neutral on error
        duration_ms = (time.perf_counter() - t0) * 1000
        return ScanResponse(
            risk_level=RiskLevel.NONE,
            score=0,
            entities=[],
            advisory="",
            show_warning=False,
            duration_ms=duration_ms,
        )
