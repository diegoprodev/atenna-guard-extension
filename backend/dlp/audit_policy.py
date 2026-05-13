"""
Audit Policy — FASE 4.2A
Adaptado de bff/app/decision_engine/audit_policy.py.

Regra absoluta (compliance LGPD Art. 46):
  record_prompt        = SEMPRE False  — prompt original JAMAIS persiste
  record_masked_prompt = SEMPRE True
  correlation_id       = OBRIGATÓRIO em todo evento

Esta é compliance policy — a lógica central não deve ser alterada.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from dlp.types import ClassificationLevel, DlpFinding, CLASSIFICATION_ORDER
from dlp.governance import get_governance, AuditLevel


@dataclass(frozen=True)
class AuditConfig:
    record_prompt:         bool    # SEMPRE False — LGPD Art. 46
    record_masked_prompt:  bool    # SEMPRE True
    record_response:       bool    # True se não bloqueado e nível permite
    record_dlp_findings:   bool    # Controlado por min_audit_level
    correlation_id:        str     # UUID único por request
    retention_days:        int
    audit_level:           str     # AuditLevel.*


def new_correlation_id() -> str:
    """Gera correlation_id único para rastreamento de evento."""
    return str(uuid.uuid4())


def resolve_audit_config(
    classification_level: ClassificationLevel,
    blocked: bool,
    dlp_findings: list[DlpFinding],
    correlation_id: str | None = None,
) -> AuditConfig:
    """
    Retorna AuditConfig imutável para este request.

    record_prompt é sempre False — compliance obrigatório.
    record_masked_prompt é sempre True.
    record_response é False se bloqueado (sem resposta para logar).
    record_dlp_findings depende do min_audit_level da governance:
      FULL     → sempre grava findings
      STANDARD → grava apenas se há findings
      MINIMAL  → não grava conteúdo, só correlation_id
    """
    cid = correlation_id or new_correlation_id()
    governance = get_governance(classification_level)
    retention = governance.retention_days
    audit_level = governance.min_audit_level

    record_dlp_findings: bool
    if audit_level == AuditLevel.FULL:
        record_dlp_findings = True
    elif audit_level == AuditLevel.STANDARD:
        record_dlp_findings = len(dlp_findings) > 0
    else:  # MINIMAL
        record_dlp_findings = False

    return AuditConfig(
        record_prompt=False,           # NUNCA — LGPD Art. 46
        record_masked_prompt=True,     # SEMPRE
        record_response=not blocked,
        record_dlp_findings=record_dlp_findings,
        correlation_id=cid,
        retention_days=retention,
        audit_level=audit_level,
    )


def build_audit_event(
    config: AuditConfig,
    user_id: str,
    event_name: str,
    classification_level: ClassificationLevel,
    masked_prompt: str,
    dlp_findings_count: int,
    model: str,
    action_taken: str,
    *,
    response_snippet: str | None = None,
) -> dict:
    """
    Monta evento de auditoria seguro para hash_chain e telemetria.
    Nunca inclui prompt original. Inclui apenas metadados seguros.
    """
    event: dict = {
        "user_id": user_id,
        "correlation_id": config.correlation_id,
        "event_name": event_name,
        "classification_level": classification_level.value,
        "dlp_findings_count": dlp_findings_count,
        "model": model,
        "retention_days": config.retention_days,
        "action_taken": action_taken,
        "audit_level": config.audit_level,
    }

    if config.record_masked_prompt:
        # Armazena apenas hash do masked_prompt — não o conteúdo
        import hashlib
        event["masked_prompt_hash"] = hashlib.sha256(
            masked_prompt.encode("utf-8")
        ).hexdigest()

    if config.record_response and response_snippet:
        event["response_snippet"] = response_snippet[:100]  # máx 100 chars

    return event
