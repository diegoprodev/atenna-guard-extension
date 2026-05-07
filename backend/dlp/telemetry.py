"""
DLP telemetry — structured JSON event log.
Writes to stdout; consumed by log aggregator or CloudWatch.
"""
from __future__ import annotations

import json
import time
from typing import Any
from .entities import RiskLevel


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
