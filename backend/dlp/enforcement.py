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
from .entities import RiskLevel


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
    server_dlp_metadata: dict,
    entities: Optional[list] = None,
) -> dict:
    """
    Avalia se strict mode deve ser aplicado.

    Args:
        input_text: Original text to potentially rewrite
        server_dlp_metadata: Server-side analysis metadata
        entities: List of entity objects from server analysis (optional)

    Retorna dict com:
    - would_apply: bool (se strict mode estivesse ativado)
    - applied: bool (se foi realmente aplicado)
    - rewritten_text: str (payload final)
    - sanitized: bool
    """
    strict_enabled = is_strict_mode_enabled()
    server_risk = server_dlp_metadata.get("dlp_risk_level", "NONE")

    # UNKNOWN means analysis failed/incomplete - handle conservatively
    if server_risk == "UNKNOWN":
        # Cannot determine risk - do not assume safety
        # In strict mode, UNKNOWN should NOT be treated as NONE
        # Log for audit purposes
        _log_event("dlp_strict_analysis_unavailable", {
            "risk_level": server_risk,
            "strict_enabled": strict_enabled,
        })
        return {
            "would_apply": False,  # UNKNOWN is not actionable for rewrite
            "applied": False,
            "rewritten_text": input_text,
            "sanitized": False,
        }

    # Only rewrite for definitive HIGH risk
    should_rewrite = server_risk == "HIGH"

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
            # Use provided entities (from server analysis) to rewrite
            # Convert Presidio RecognizerResult objects to dict format if needed
            entity_list = []
            if entities:
                for entity in entities:
                    if hasattr(entity, '__dict__'):
                        # It's a RecognizerResult object
                        entity_list.append({
                            "type": entity.entity_type,
                            "value": entity.text,
                            "start": entity.start,
                            "end": entity.end,
                        })
                    else:
                        # Already a dict
                        entity_list.append(entity)

            if entity_list:
                rewritten = rewrite_pii_tokens(input_text, entity_list)
                result["rewritten_text"] = rewritten
                result["applied"] = True
                result["sanitized"] = True

                # Log: strict enforcement aplicado
                _log_event("dlp_strict_applied", {
                    "original_length": len(input_text),
                    "rewritten_length": len(rewritten),
                    "entity_count": len(entity_list),
                    "entity_types": [e.get("type") for e in entity_list],
                })
        except Exception as e:
            # Se rewrite falhar, usa original (fail-open)
            _log_event("dlp_strict_error", {
                "error": str(e),
                "risk_level": server_risk,
            })
    else:
        # Modo observação: registra o que TERIA feito
        _log_event("dlp_strict_would_apply", {
            "risk_level": server_risk,
            "entities": server_dlp_metadata.get("dlp_entity_types", []),
        })

    return result


def _log_event(event_type: str, data: dict) -> None:
    """Registra evento estruturado para auditoria."""
    event = {
        "event": event_type,
        **data,
    }
    print(json.dumps(event), flush=True)
