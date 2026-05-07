"""
DLP pipeline orchestrator — runs full backend analysis and returns a ScanResponse.
Never raises: returns safe default on error so generation is never blocked.
Includes timeout protection to ensure frontend is never blocked.
"""
from __future__ import annotations

import asyncio
import time

from .entities import RiskLevel, ScanRequest, ScanResponse
from .analyzer import analyze
from .scoring import score_results
from .advisory import build_response
from . import telemetry

# Timeout constant (same as engine)
SCAN_TIMEOUT_SECONDS = 3.0


async def run(request: ScanRequest) -> ScanResponse:
    t0 = time.perf_counter()
    telemetry.scan_started(request.session_id, request.platform)

    try:
        # Run Presidio analysis with timeout protection
        loop = asyncio.get_event_loop()
        results = await asyncio.wait_for(
            loop.run_in_executor(None, analyze, request.text),
            timeout=SCAN_TIMEOUT_SECONDS,
        )

        score, risk_level = score_results(
            results,
            client_score=request.client_score,
        )

        entity_types = [r.entity_type for r in results]

        # Per-entity telemetry
        for r in results:
            telemetry.entity_detected(r.entity_type, risk_level, r.score, request.session_id)

        if risk_level == RiskLevel.HIGH:
            telemetry.high_risk(score, entity_types, request.session_id)

        duration_ms = (time.perf_counter() - t0) * 1000

        telemetry.latency("backend", duration_ms, request.session_id)
        telemetry.risk_distribution(risk_level, entity_types, score, request.platform)
        telemetry.scan_complete(duration_ms, risk_level, request.session_id, len(results))

        return build_response(risk_level, score, results, request.text, duration_ms)

    except asyncio.TimeoutError:
        # Timeout: return safe default (NONE risk)
        duration_ms = (time.perf_counter() - t0) * 1000
        telemetry.dlp_timeout(
            session_id=request.session_id,
            endpoint="scan",
            duration_ms=duration_ms,
            source="client",
        )
        return ScanResponse(
            risk_level=RiskLevel.NONE,
            score=0,
            entities=[],
            advisory="",
            show_warning=False,
            duration_ms=duration_ms,
        )

    except Exception as e:
        # Any error: return safe default
        duration_ms = (time.perf_counter() - t0) * 1000
        telemetry.dlp_engine_error(
            session_id=request.session_id,
            endpoint="scan",
            error_type=type(e).__name__,
            duration_ms=duration_ms,
        )
        return ScanResponse(
            risk_level=RiskLevel.NONE,
            score=0,
            entities=[],
            advisory="",
            show_warning=False,
            duration_ms=duration_ms,
        )
