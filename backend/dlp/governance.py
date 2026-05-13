"""
Governance Matrix — FASE 4.2A
Adaptado de bff/app/decision_engine/governance_policy.py.

Matriz declarativa de constraints por ClassificationLevel.
Tenants só podem reduzir limites — nunca aumentar acima do sistema.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from dlp.types import ClassificationLevel


class ModelConstraint:
    NONE             = "none"              # provider externo permitido
    LOCAL_PREFERRED  = "local_preferred"   # preferir LLM local quando disponível
    LOCAL_ONLY       = "local_only"        # obrigatório — dado secret/confidential


class AuditLevel:
    MINIMAL  = "minimal"   # apenas correlation_id + resultado
    STANDARD = "standard"  # + masked_prompt + response snippet
    FULL     = "full"      # + dlp_findings + performance + provenance


@dataclass(frozen=True)
class GovernanceConstraints:
    retention_days:       int
    max_retention_days:   int
    model_constraint:     str            # ModelConstraint.*
    min_audit_level:      str            # AuditLevel.*
    dlp_block_threshold:  str            # "critical" | "high" | "medium" | "low" | "none"
    allowed_providers:    tuple[str, ...]  # () = todos; ("local",) = apenas local
    require_human_review: bool
    show_warning:         bool


# ─── Matriz canônica ───────────────────────────────────────────────────────────
#
# Nota sobre local_only na Atenna Safe v1:
#   Ainda não há modelo local. local_only = bloquear provider externo e
#   exibir mensagem informativa. Será implementado como modelo local em fase futura.

CLASSIFICATION_GOVERNANCE: dict[str, GovernanceConstraints] = {

    ClassificationLevel.PUBLIC.value: GovernanceConstraints(
        retention_days=365,
        max_retention_days=365,
        model_constraint=ModelConstraint.NONE,
        min_audit_level=AuditLevel.STANDARD,
        dlp_block_threshold="critical",
        allowed_providers=(),           # () = todos os providers permitidos
        require_human_review=False,
        show_warning=False,
    ),

    ClassificationLevel.INTERNAL.value: GovernanceConstraints(
        retention_days=365,
        max_retention_days=365,
        model_constraint=ModelConstraint.NONE,
        min_audit_level=AuditLevel.STANDARD,
        dlp_block_threshold="critical",
        allowed_providers=(),
        require_human_review=False,
        show_warning=False,
    ),

    ClassificationLevel.RESTRICTED.value: GovernanceConstraints(
        retention_days=90,
        max_retention_days=90,
        model_constraint=ModelConstraint.LOCAL_PREFERRED,
        min_audit_level=AuditLevel.FULL,
        dlp_block_threshold="high",
        allowed_providers=(),           # todos permitidos, mas preferir local
        require_human_review=False,
        show_warning=True,
    ),

    ClassificationLevel.CONFIDENTIAL.value: GovernanceConstraints(
        retention_days=30,
        max_retention_days=30,
        model_constraint=ModelConstraint.LOCAL_ONLY,
        min_audit_level=AuditLevel.FULL,
        dlp_block_threshold="medium",
        allowed_providers=("local",),   # apenas local (futuro)
        require_human_review=False,
        show_warning=True,
    ),

    ClassificationLevel.SECRET.value: GovernanceConstraints(
        retention_days=7,
        max_retention_days=7,
        model_constraint=ModelConstraint.LOCAL_ONLY,
        min_audit_level=AuditLevel.FULL,
        dlp_block_threshold="low",
        allowed_providers=("local",),
        require_human_review=True,
        show_warning=True,
    ),
}


def get_governance(level: ClassificationLevel) -> GovernanceConstraints:
    """Retorna constraints para o nível de classificação informado."""
    return CLASSIFICATION_GOVERNANCE[level.value]


def provider_allowed(level: ClassificationLevel, provider_host: str) -> bool:
    """
    True se o provider está autorizado para este nível de classificação.
    Na Atenna Safe v1, local_only bloqueia qualquer provider externo.
    """
    constraints = get_governance(level)
    if not constraints.allowed_providers:
        return True  # () = todos permitidos
    return provider_host in constraints.allowed_providers


def effective_retention(level: ClassificationLevel) -> int:
    """Retorna o número de dias de retenção para o nível informado."""
    return get_governance(level).retention_days
