"""
Hash Chain — FASE 4.2A
Adaptado de bff/app/audit/hash_chain.py (63 linhas, forensic-grade).

Trilha de auditoria imutável via SHA-256 encadeado.
Cada evento é encadeado ao anterior — impossível modificar histórico
sem quebrar a cadeia inteira.

Não tem dependências externas além de hashlib e json (stdlib).
NÃO modificar _CANONICAL_FIELDS sem coordenação explícita.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

# Hash do primeiro evento de um usuário (gênesis)
GENESIS_HASH: str = "0" * 64

# Campos canônicos em ordem fixa — determinismo garantido
_CANONICAL_FIELDS: tuple[str, ...] = (
    "user_id",
    "correlation_id",
    "event_name",
    "classification_level",
    "masked_prompt_hash",
    "dlp_findings_count",
    "model",
    "retention_days",
    "created_at",
)

# Eventos válidos para hash chain — qualquer outro é rejeitado
VALID_EVENTS: frozenset[str] = frozenset({
    "dlp_high_detected",
    "dlp_critical_blocked",
    "document_uploaded",
    "document_sanitized",
    "payload_sent_to_provider",
    "user_export_requested",
    "account_deletion_requested",
    "retention_purge_completed",
    "strict_mode_applied",
})


def compute_hash(prev_hash: str, event: dict) -> str:
    """
    Retorna sha256(prev_hash + canonical_json(event)).

    Determinístico: mesma entrada sempre produz mesmo hash.
    Encadeado: prev_hash do evento anterior é incluído na entrada.
    Canônico: apenas _CANONICAL_FIELDS, em ordem fixa, sem extras.
    """
    canonical = {k: event.get(k, None) for k in _CANONICAL_FIELDS}
    payload = prev_hash + json.dumps(canonical, sort_keys=True, ensure_ascii=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_event(
    *,
    user_id: str,
    correlation_id: str,
    event_name: str,
    classification_level: str,
    masked_prompt_hash: str = "",
    dlp_findings_count: int = 0,
    model: str = "",
    retention_days: int = 365,
    created_at: str | None = None,
) -> dict:
    """
    Monta evento canônico pronto para compute_hash().
    Campos extras são ignorados pelo hash (não fazem parte de _CANONICAL_FIELDS).
    """
    if event_name not in VALID_EVENTS:
        raise ValueError(f"Evento inválido para hash chain: '{event_name}'. "
                         f"Válidos: {sorted(VALID_EVENTS)}")

    return {
        "user_id": user_id,
        "correlation_id": correlation_id,
        "event_name": event_name,
        "classification_level": classification_level,
        "masked_prompt_hash": masked_prompt_hash,
        "dlp_findings_count": dlp_findings_count,
        "model": model,
        "retention_days": retention_days,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
    }


def verify_chain(events: list[dict]) -> bool:
    """
    Verifica integridade de uma cadeia de eventos.
    Cada evento deve ter 'hash' e 'prev_hash'.
    Retorna True se a cadeia é íntegra, False se adulterada.
    """
    if not events:
        return True

    prev = GENESIS_HASH
    for evt in events:
        expected = compute_hash(prev, evt)
        if evt.get("hash") != expected:
            return False
        prev = expected
    return True
