"""
Strict Mode Enforcement Service

Responsável por:
- Decidir se input requer proteção rigorosa (rewrite automático)
- Aplicar rewrite antes de enviar ao modelo
- Registrar decisões para auditoria
"""

import os
import json
from typing import Optional
from .pipeline import run as dlp_analyze
from .entities import ScanRequest, RiskLevel


def is_strict_mode_enabled() -> bool:
    """Verifica se STRICT_DLP_MODE está ativado."""
    return os.getenv("STRICT_DLP_MODE", "false").lower() == "true"


def should_apply_strict_enforcement(risk_level: str) -> bool:
    """Decide se deve aplicar proteção rigorosa para este risk level."""
    return risk_level == "HIGH" and is_strict_mode_enabled()


def rewrite_pii_tokens(text: str, entities: list) -> str:
    """
    Reescreve PII com tokens semânticos.
    Implementação básica: substitui valores por [TIPO].

    Futuro: usar semantic tokens de rewriter.ts (PT-BR)
    """
    result = text

    # Ordena por offset descendente para não quebrar posições
    sorted_entities = sorted(
        entities,
        key=lambda e: e.get("start", 0),
        reverse=True
    )

    for entity in sorted_entities:
        entity_type = entity.get("type", "UNKNOWN")
        start = entity.get("start", 0)
        end = entity.get("end", len(text))

        # Converte nome da entidade para token PT-BR
        token_map = {
            "BR_CPF": "[CPF]",
            "BR_CNPJ": "[CNPJ]",
            "EMAIL_ADDRESS": "[EMAIL]",
            "PHONE_NUMBER": "[TELEFONE]",
            "API_KEY": "[CHAVE_API]",
            "JWT": "[TOKEN_JWT]",
            "CREDIT_CARD": "[CARTÃO]",
            "BR_PHONE": "[TELEFONE]",
            "PERSON": "[PESSOA]",
            "LOCATION": "[LOCAL]",
        }

        token = token_map.get(entity_type, f"[{entity_type}]")
        result = result[:start] + token + result[end:]

    return result


def evaluate_strict_enforcement(
    input_text: str,
    client_dlp_metadata: dict,
) -> dict:
    """
    Avalia se strict mode deve ser aplicado.

    Retorna dict com:
    - would_apply: bool (se strict mode estivesse ativado)
    - applied: bool (se foi realmente aplicado)
    - rewritten_text: str (payload final)
    - sanitized: bool
    """
    strict_enabled = is_strict_mode_enabled()
    client_risk = client_dlp_metadata.get("dlp_risk_level", "NONE")

    # Simular ou aplicar rewrite
    should_rewrite = client_risk == "HIGH"

    result = {
        "would_apply": should_rewrite,  # se strict estivesse ativado
        "applied": False,  # se foi realmente aplicado
        "rewritten_text": input_text,
        "sanitized": False,
    }

    if not should_rewrite:
        return result

    # Se strict mode está ativado, aplica rewrite
    if strict_enabled:
        try:
            # Re-analisa server-side para obter entidades
            scan_req = ScanRequest(text=input_text)
            dlp_result = dlp_analyze(scan_req)

            if dlp_result.risk_level == "HIGH" and dlp_result.entities:
                rewritten = rewrite_pii_tokens(input_text, dlp_result.entities)
                result["rewritten_text"] = rewritten
                result["applied"] = True
                result["sanitized"] = True

                # Log: strict enforcement aplicado
                _log_event("dlp_strict_applied", {
                    "original_length": len(input_text),
                    "rewritten_length": len(rewritten),
                    "entity_count": len(dlp_result.entities),
                    "entity_types": [e.get("type") for e in dlp_result.entities],
                })
        except Exception as e:
            # Se rewrite falhar, usa original (fail-open)
            _log_event("dlp_strict_error", {
                "error": str(e),
                "risk_level": client_risk,
            })
    else:
        # Modo observação: registra o que TERIA feito
        _log_event("dlp_strict_would_apply", {
            "risk_level": client_risk,
            "entities": client_dlp_metadata.get("dlp_entity_types", []),
        })

    return result


def _log_event(event_type: str, data: dict) -> None:
    """Registra evento estruturado para auditoria."""
    event = {
        "event": event_type,
        **data,
    }
    print(json.dumps(event), flush=True)
