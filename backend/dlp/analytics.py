"""
FASE 2.2: Safe Analytics Queries

Provides aggregated statistics without PII or individual event details.
Used for metrics dashboard, monitoring, compliance reporting.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Any

from .supabase_telemetry import get_supabase_persistence


def get_user_metrics(
    user_id: str,
    days: int = 30,
) -> dict[str, Any]:
    """
    Get safe user metrics (no PII).

    Args:
        user_id: User ID
        days: Look back N days (default 30)

    Returns:
        {
            "total_events": int,
            "by_risk_level": {"HIGH": 50, "MEDIUM": 200, ...},
            "by_entity_type": {"BR_CPF": 300, "EMAIL": 250, ...},
            "rewrite_rate": float,  # %
            "timeout_rate": float,  # %
            "error_rate": float,    # %
            "mismatch_rate": float, # %
            "avg_latency_ms": float,
            "period_days": int,
        }
    """
    persistence = get_supabase_persistence()

    # Get all events for user in period
    # (In real Supabase: use server-side aggregation via SQL functions)
    events = persistence.get_events(session_id=None)  # TODO: filter by user_id

    if not events:
        return {
            "total_events": 0,
            "by_risk_level": {},
            "by_entity_type": {},
            "rewrite_rate": 0.0,
            "timeout_rate": 0.0,
            "error_rate": 0.0,
            "mismatch_rate": 0.0,
            "avg_latency_ms": 0.0,
            "period_days": days,
        }

    total = len(events)
    risk_counts = {}
    entity_type_counts = {}
    rewrite_count = 0
    timeout_count = 0
    error_count = 0
    mismatch_count = 0
    latencies = []

    for event in events:
        # Risk level distribution
        if event.risk_level:
            risk_counts[event.risk_level] = risk_counts.get(event.risk_level, 0) + 1

        # Entity type distribution
        if event.entity_types:
            for etype in event.entity_types:
                entity_type_counts[etype] = entity_type_counts.get(etype, 0) + 1

        # Behavioral metrics
        if event.was_rewritten:
            rewrite_count += 1
        if event.timeout_occurred:
            timeout_count += 1
        if event.error_occurred:
            error_count += 1
        if event.had_mismatch:
            mismatch_count += 1

        # Latency
        if event.duration_ms:
            latencies.append(event.duration_ms)

    avg_latency = sum(latencies) / len(latencies) if latencies else 0

    return {
        "total_events": total,
        "by_risk_level": risk_counts,
        "by_entity_type": entity_type_counts,
        "rewrite_rate": rewrite_count / total if total > 0 else 0.0,
        "timeout_rate": timeout_count / total if total > 0 else 0.0,
        "error_rate": error_count / total if total > 0 else 0.0,
        "mismatch_rate": mismatch_count / total if total > 0 else 0.0,
        "avg_latency_ms": round(avg_latency, 2),
        "period_days": days,
    }


def get_system_metrics() -> dict[str, Any]:
    """
    Get system-wide metrics (aggregated across all users).
    No user-specific data.

    Returns:
        {
            "total_events_all_time": int,
            "high_risk_count": int,
            "false_positive_rate": float,
            "avg_latency_ms": float,
        }
    """
    persistence = get_supabase_persistence()

    events = persistence.get_events()

    if not events:
        return {
            "total_events_all_time": 0,
            "high_risk_count": 0,
            "false_positive_rate": 0.0,
            "avg_latency_ms": 0.0,
        }

    total = len(events)
    high_risk_count = len([e for e in events if e.risk_level == "HIGH"])
    latencies = [e.duration_ms for e in events if e.duration_ms]
    avg_latency = sum(latencies) / len(latencies) if latencies else 0

    return {
        "total_events_all_time": total,
        "high_risk_count": high_risk_count,
        "false_positive_rate": high_risk_count / total if total > 0 else 0.0,
        "avg_latency_ms": round(avg_latency, 2),
    }


def get_entity_risk_matrix() -> dict[str, dict[str, int]]:
    """
    Entity type vs risk level matrix.

    Returns:
        {
            "BR_CPF": {"HIGH": 50, "MEDIUM": 30, "LOW": 10},
            "EMAIL": {"MEDIUM": 100, "LOW": 50},
            ...
        }
    """
    persistence = get_supabase_persistence()

    events = persistence.get_events()
    matrix = {}

    for event in events:
        if not event.entity_types:
            continue

        for entity_type in event.entity_types:
            if entity_type not in matrix:
                matrix[entity_type] = {}

            risk = event.risk_level or "UNKNOWN"
            matrix[entity_type][risk] = matrix[entity_type].get(risk, 0) + 1

    return matrix


def get_endpoint_performance() -> dict[str, dict[str, float]]:
    """
    Performance metrics by endpoint.

    Returns:
        {
            "/scan": {
                "avg_latency_ms": 150.5,
                "p95_latency_ms": 250.0,
                "p99_latency_ms": 350.0,
                "timeout_rate": 0.01,
            },
            "/generate-prompts": {...},
        }
    """
    persistence = get_supabase_persistence()

    events = persistence.get_events()
    endpoints = {}

    for event in events:
        if not event.endpoint:
            continue

        if event.endpoint not in endpoints:
            endpoints[event.endpoint] = {
                "latencies": [],
                "timeouts": 0,
                "total": 0,
            }

        endpoints[event.endpoint]["total"] += 1
        if event.duration_ms:
            endpoints[event.endpoint]["latencies"].append(event.duration_ms)
        if event.timeout_occurred:
            endpoints[event.endpoint]["timeouts"] += 1

    # Calculate percentiles
    result = {}
    for endpoint, data in endpoints.items():
        latencies = sorted(data["latencies"])
        n = len(latencies)

        result[endpoint] = {
            "avg_latency_ms": (
                sum(latencies) / n if n > 0 else 0
            ),
            "p95_latency_ms": (
                latencies[int(n * 0.95)] if n > 0 else 0
            ),
            "p99_latency_ms": (
                latencies[int(n * 0.99)] if n > 0 else 0
            ),
            "timeout_rate": (
                data["timeouts"] / data["total"] if data["total"] > 0 else 0
            ),
        }

    return result
