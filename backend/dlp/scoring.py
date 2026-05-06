"""
Contextual scoring — converts Presidio results to a 0-100 risk score.
Combines entity severity, confidence, quantity, and context signals.
"""
from __future__ import annotations

from presidio_analyzer import RecognizerResult
from .entities import RiskLevel

# Base severity by entity type
ENTITY_SEVERITY: dict[str, float] = {
    "API_KEY":         90,
    "CRYPTO":          85,
    "PASSWORD":        85,
    "CREDIT_CARD":     80,
    "BR_CPF":          75,
    "PERSON":          70,
    "BR_CNPJ":         65,
    "EMAIL_ADDRESS":   45,
    "BR_PHONE":        42,
    "PHONE_NUMBER":    40,
    "LOCATION":        30,
    "DATE_TIME":       10,
    "NRP":             20,
}


def score_results(
    results:      list[RecognizerResult],
    client_score: float | None = None,
) -> tuple[float, RiskLevel]:
    """
    Returns (score 0-100, RiskLevel).
    Blends backend Presidio score with optional client pre-scan score.
    """
    if not results:
        backend_score = 0.0
    else:
        # Max entity severity weighted by presidio confidence
        backend_score = max(
            ENTITY_SEVERITY.get(r.entity_type, 35) * r.score
            for r in results
        )
        backend_score = min(100.0, backend_score)

    if client_score is not None:
        # Weighted blend: backend is authoritative, client provides fast signal
        final = 0.6 * backend_score + 0.4 * float(client_score)
    else:
        final = backend_score

    level = _score_to_level(final)
    return round(final, 1), level


def _score_to_level(score: float) -> RiskLevel:
    if score < 15:  return RiskLevel.NONE
    if score < 40:  return RiskLevel.LOW
    if score < 68:  return RiskLevel.MEDIUM
    return RiskLevel.HIGH
