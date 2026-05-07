"""
DLP telemetry — structured JSON event log.
Writes to stdout; consumed by log aggregator or CloudWatch.

TASK 7: Also persists safe telemetry to database (zero PII).
"""
from __future__ import annotations

import json
import time
from typing import Any
from .entities import RiskLevel
from .telemetry_persistence import persist_event


def _emit(event: str, payload: dict[str, Any]) -> None:
    print(json.dumps({"event": event, "ts": time.time(), **payload}), flush=True)


def scan_started(session_id: str | None, platform: str | None) -> None:
    _emit("dlp_scan_started", {"session_id": session_id, "platform": platform})


def entity_detected(
    entity_type: str,
    risk_level:  RiskLevel,
    score:       float,
    session_id:  str | None,
) -> None:
    _emit("dlp_entity_detected", {
        "entity_type": entity_type,
        "risk_level":  risk_level,
        "score":       round(score, 4),
        "session_id":  session_id,
    })


def high_risk(score: float, entity_types: list[str], session_id: str | None) -> None:
    _emit("dlp_high_risk", {
        "score":        round(score, 4),
        "entity_types": entity_types,
        "session_id":   session_id,
    })


def warning_shown(risk_level: RiskLevel, session_id: str | None) -> None:
    _emit("dlp_warning_shown", {"risk_level": risk_level, "session_id": session_id})


def send_override(risk_level: RiskLevel, session_id: str | None) -> None:
    _emit("dlp_send_override", {"risk_level": risk_level, "session_id": session_id})


def false_positive_feedback(
    entity_type: str,
    session_id:  str | None,
    user_id:     str | None = None,
) -> None:
    _emit("dlp_false_positive_feedback", {
        "entity_type": entity_type,
        "session_id":  session_id,
        "user_id":     user_id,
    })


def scan_complete(
    duration_ms: float,
    risk_level:  RiskLevel,
    session_id:  str | None,
    entity_count: int = 0,
) -> None:
    _emit("dlp_scan_complete", {
        "duration_ms":  round(duration_ms, 2),
        "risk_level":   risk_level,
        "entity_count": entity_count,
        "session_id":   session_id,
    })

    # TASK 7: Persist safe telemetry event (zero PII)
    persist_event(
        event_type="dlp_scan_complete",
        risk_level=risk_level,
        entity_count=entity_count,
        duration_ms=duration_ms,
        session_id=session_id,
    )


def latency(
    phase:       str,  # "client" | "backend" | "total"
    duration_ms: float,
    session_id:  str | None,
) -> None:
    _emit("dlp_latency", {
        "phase":       phase,
        "duration_ms": round(duration_ms, 2),
        "session_id":  session_id,
    })


def risk_distribution(
    risk_level:   RiskLevel,
    entity_types: list[str],
    score:        float,
    platform:     str | None,
) -> None:
    _emit("dlp_risk_distribution", {
        "risk_level":   risk_level,
        "entity_types": entity_types,
        "score":        round(score, 4),
        "platform":     platform,
    })


# ─── TASK 4: Server-side Revalidation ────────────────────────

def engine_analyzed(
    session_id: str | None,
    source: str,  # "client" or "server"
    risk_level: str,
    entity_count: int,
    duration_ms: float,
    entity_types: list[str] | None = None,
) -> None:
    """Engine completed analysis."""
    _emit("dlp_engine_analyzed", {
        "session_id": session_id,
        "source": source,
        "risk_level": risk_level,
        "entity_count": entity_count,
        "duration_ms": round(duration_ms, 2),
    })

    # TASK 7: Persist safe telemetry event (zero PII)
    persist_event(
        event_type="dlp_engine_analyzed",
        risk_level=risk_level,
        entity_types=entity_types or [],
        entity_count=entity_count,
        duration_ms=duration_ms,
        source=source,
        session_id=session_id,
    )


def mismatch_detected(
    session_id: str | None,
    divergence_type: str,  # client_low_server_high, etc
    client_risk: str,
    server_risk: str,
    confidence: float,
) -> None:
    """Client vs server finding divergence detected."""
    _emit("dlp_server_mismatch", {
        "session_id": session_id,
        "divergence_type": divergence_type,
        "client_risk": client_risk,
        "server_risk": server_risk,
        "confidence": round(confidence, 2),
    })


def server_revalidated(
    session_id: str | None,
    text_hash: str,
    client_risk: str,
    server_risk: str,
    protected_tokens_detected: bool,
    entity_types: list[str] | None = None,
    entity_count: int = 0,
) -> None:
    """Server-side revalidation completed."""
    _emit("dlp_server_revalidated", {
        "session_id": session_id,
        "text_hash": text_hash,
        "client_risk": client_risk,
        "server_risk": server_risk,
        "protected_tokens_detected": protected_tokens_detected,
    })

    # TASK 7: Persist safe telemetry event (zero PII)
    persist_event(
        event_type="dlp_server_revalidated",
        risk_level=server_risk,
        entity_types=entity_types or [],
        entity_count=entity_count,
        had_mismatch=(client_risk != server_risk),
        source="server",
        endpoint="/generate-prompts",
        session_id=session_id,
    )


# ─── TASK 5: Timeout Safety ──────────────────────────────────

def dlp_timeout(
    session_id: str | None,
    endpoint: str,  # "analyze", "scan", or "generate-prompts"
    duration_ms: float,
    source: str,  # "client" or "server"
) -> None:
    """DLP analysis timed out after ANALYSIS_TIMEOUT_SECONDS."""
    _emit("dlp_timeout", {
        "session_id": session_id,
        "endpoint": endpoint,
        "duration_ms": round(duration_ms, 2),
        "source": source,
        "status": "fallback_unknown",  # Fell back to UNKNOWN risk
    })

    # TASK 7: Persist safe telemetry event (zero PII)
    persist_event(
        event_type="dlp_timeout",
        risk_level="UNKNOWN",  # Conservative: analysis unavailable
        timeout_occurred=True,
        duration_ms=duration_ms,
        source=source,
        endpoint=endpoint,
        session_id=session_id,
    )


def dlp_engine_error(
    session_id: str | None,
    endpoint: str,  # "analyze", "scan", or "generate-prompts"
    error_type: str,  # Exception class name
    duration_ms: float,
) -> None:
    """DLP engine encountered error and fell back to UNKNOWN risk."""
    _emit("dlp_engine_error", {
        "session_id": session_id,
        "endpoint": endpoint,
        "error_type": error_type,
        "duration_ms": round(duration_ms, 2),
        "status": "fallback_unknown",  # Fell back to UNKNOWN risk
    })

    # TASK 7: Persist safe telemetry event (zero PII)
    persist_event(
        event_type="dlp_engine_error",
        risk_level="UNKNOWN",  # Conservative: analysis unavailable
        error_occurred=True,
        duration_ms=duration_ms,
        endpoint=endpoint,
        session_id=session_id,
    )


def dlp_analysis_unavailable(
    session_id: str | None,
    reason: str,  # "timeout", "error", "unavailable"
    endpoint: str,
    duration_ms: float,
) -> None:
    """DLP analysis was unavailable (timeout, error, or provider issue)."""
    _emit("dlp_analysis_unavailable", {
        "session_id": session_id,
        "reason": reason,
        "endpoint": endpoint,
        "duration_ms": round(duration_ms, 2),
        "risk_level": "UNKNOWN",
    })

    # TASK 7: Persist safe telemetry event (zero PII)
    persist_event(
        event_type="dlp_analysis_unavailable",
        risk_level="UNKNOWN",
        duration_ms=duration_ms,
        endpoint=endpoint,
        session_id=session_id,
    )
