"""
DLP telemetry — lightweight event log.
Writes structured JSON events to stdout (picked up by log aggregator).
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
        "score":       score,
        "session_id":  session_id,
    })


def high_risk(score: float, entity_types: list[str], session_id: str | None) -> None:
    _emit("dlp_high_risk", {
        "score":        score,
        "entity_types": entity_types,
        "session_id":   session_id,
    })


def scan_complete(duration_ms: float, risk_level: RiskLevel, session_id: str | None) -> None:
    _emit("dlp_scan_complete", {
        "duration_ms": duration_ms,
        "risk_level":  risk_level,
        "session_id":  session_id,
    })
