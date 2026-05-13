"""
Classification Resolver — FASE 4.2A
Adaptado de bff/app/decision_engine/classification_resolver.py.

Mapeia RiskLevel → ClassificationLevel (5 níveis LGPD).
O nível mais restritivo sempre prevalece.
"""
from __future__ import annotations

from dlp.types import (
    ClassificationLevel,
    CLASSIFICATION_ORDER,
    DlpFinding,
    RiskLevel,
)

# ─── Mapeamento canônico Risk → Classification ─────────────────────────────────
# UNKNOWN → internal (conservador: registra flag operacional, não bloqueia UX)

RISK_TO_CLASSIFICATION: dict[RiskLevel, ClassificationLevel] = {
    RiskLevel.NONE:     ClassificationLevel.PUBLIC,
    RiskLevel.LOW:      ClassificationLevel.INTERNAL,
    RiskLevel.MEDIUM:   ClassificationLevel.INTERNAL,
    RiskLevel.HIGH:     ClassificationLevel.RESTRICTED,
    RiskLevel.CRITICAL: ClassificationLevel.CONFIDENTIAL,
    RiskLevel.UNKNOWN:  ClassificationLevel.INTERNAL,
}


def resolve_classification(risk: RiskLevel) -> ClassificationLevel:
    """Retorna o ClassificationLevel correspondente ao RiskLevel."""
    return RISK_TO_CLASSIFICATION.get(risk, ClassificationLevel.INTERNAL)


def resolve_max(findings: list[DlpFinding]) -> ClassificationLevel:
    """
    Retorna o nível de classificação mais restritivo dentre todos os findings.
    Regra: nível mais restritivo sempre prevalece.
    """
    if not findings:
        return ClassificationLevel.PUBLIC

    max_level = ClassificationLevel.PUBLIC
    for f in findings:
        if CLASSIFICATION_ORDER[f.classification_level.value] > CLASSIFICATION_ORDER[max_level.value]:
            max_level = f.classification_level
    return max_level


def show_warning(level: ClassificationLevel) -> bool:
    """True para restricted e acima — exige UX de alerta."""
    return CLASSIFICATION_ORDER[level.value] >= CLASSIFICATION_ORDER["restricted"]


def requires_acknowledgment(level: ClassificationLevel) -> bool:
    """True para restricted e acima — exige confirmação explícita do usuário."""
    return CLASSIFICATION_ORDER[level.value] >= CLASSIFICATION_ORDER["restricted"]
