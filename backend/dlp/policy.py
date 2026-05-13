"""
Policy Engine — FASE 4.2A
Adaptado de bff/app/decision_engine/dlp_policy.py.

Combina scanner + classification + regras de negócio em decisão única.
Interface: evaluate(text, strict_mode) → PolicyResult
"""
from __future__ import annotations

from dataclasses import dataclass

from dlp.scanner import scan
from dlp.classification import resolve_max, requires_acknowledgment
from dlp.types import (
    ClassificationLevel,
    DlpFinding,
    DlpScanResult,
    EntityType,
    RiskLevel,
    RISK_ORDER,
)


# Entidades que sempre bloqueiam — independente de strict_mode
_BLOCK_ENTITIES: frozenset[EntityType] = frozenset({
    EntityType.API_KEY,
    EntityType.JWT,
    EntityType.SECRET,
    EntityType.TOKEN,
    EntityType.CREDIT_CARD,
})

# Entidades que mascaram automaticamente em strict_mode
_STRICT_MASK_ENTITIES: frozenset[EntityType] = frozenset({
    EntityType.CPF,
    EntityType.CNPJ,
    EntityType.RG,
    EntityType.PIS_PASEP,
    EntityType.TITULO_ELEITOR,
    EntityType.PROCESS_NUMBER,
    EntityType.MEDICAL_DATA,
    EntityType.CONFIDENTIAL_DOCUMENT,
})


@dataclass(frozen=True)
class PolicyResult:
    masked_text:             str
    findings:                tuple[DlpFinding, ...]
    max_risk:                RiskLevel
    classification_level:    ClassificationLevel
    blocked:                 bool
    block_reason:            str | None
    requires_acknowledgment: bool
    scan_result:             DlpScanResult


def evaluate(text: str, strict_mode: bool = False) -> PolicyResult:
    """
    Avalia texto contra policy DLP.

    strict_mode=True  → HIGH+ mascara automaticamente antes do provider.
    strict_mode=False → HIGH+ alerta, usuário decide; CRITICAL ainda bloqueia.

    Regras:
      CRITICAL (API_KEY, JWT, SECRET, TOKEN, CREDIT_CARD) → blocked=True sempre
      HIGH + strict_mode=True                             → masked automático
      HIGH + strict_mode=False                            → alerta, não bloqueia
      MEDIUM                                              → alerta, não bloqueia
      LOW                                                 → registra, não bloqueia
      UNKNOWN                                             → registra, não trata como NONE
    """
    result = scan(text)

    # Se o scanner já bloqueou (action=block nos findings), respeitar
    blocked = result.blocked
    block_reason = result.block_reason

    # Se múltiplos dados pessoais combinados em classificação secret → bloquear
    if not blocked and _is_combined_high_risk(result.findings):
        blocked = True
        block_reason = "Combinação de múltiplos dados pessoais sensíveis detectada"

    # Documento classificado como secret → bloquear provider
    if not blocked and result.classification_level == ClassificationLevel.SECRET:
        blocked = True
        block_reason = "Documento classificado como secret — provider externo não permitido"

    # Em strict mode: HIGH+ → forçar mascaramento de findings com action='alert' também.
    # O scanner já mascarou 'mask'/'block' em result.masked_content.
    # _apply_strict_masking parte do masked_content e cobre os 'alert' restantes.
    masked_text = result.masked_content
    if strict_mode and not blocked:
        masked_text = _apply_strict_masking(result.masked_content, result.findings)

    max_risk = result.risk_level
    classification = resolve_max(list(result.findings))
    ack = requires_acknowledgment(classification)

    return PolicyResult(
        masked_text=masked_text,
        findings=result.findings,
        max_risk=max_risk,
        classification_level=classification,
        blocked=blocked,
        block_reason=block_reason,
        requires_acknowledgment=ack,
        scan_result=result,
    )


def _is_combined_high_risk(findings: tuple[DlpFinding, ...]) -> bool:
    """
    True se há 3+ entidades HIGH/CRITICAL distintas de dados pessoais.
    Combinação massiva → risco de re-identificação.
    """
    personal_high = {
        EntityType.CPF, EntityType.CNPJ, EntityType.RG,
        EntityType.PIS_PASEP, EntityType.TITULO_ELEITOR,
        EntityType.PROCESS_NUMBER, EntityType.CREDIT_CARD,
    }
    high_types = {
        f.entity_type for f in findings
        if f.entity_type in personal_high
        and RISK_ORDER.get(f.risk_level.value, 0) >= RISK_ORDER["HIGH"]
    }
    return len(high_types) >= 3


def _apply_strict_masking(original: str, findings: tuple[DlpFinding, ...]) -> str:
    """
    Em strict_mode, mascara TODOS os findings incluindo os de action='alert'.
    O scanner já mascarou 'mask' e 'block'; aqui cobrimos 'alert' também.
    """
    alert_findings = [f for f in findings if f.action == "alert"]
    if not alert_findings:
        # Scanner já mascarou tudo — retornar o masked_content
        return original

    masked = original
    for f in sorted(alert_findings, key=lambda x: x.start, reverse=True):
        masked = masked[:f.start] + f.placeholder + masked[f.end:]
    return masked
