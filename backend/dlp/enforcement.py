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


_TOKEN_MAP = {
    "BR_CPF": "[CPF]",
    "BR_CNPJ": "[CNPJ]",
    "BR_PHONE": "[TELEFONE]",
    "PHONE_NUMBER": "[TELEFONE]",
    "EMAIL_ADDRESS": "[EMAIL]",
    "EMAIL": "[EMAIL]",
    "API_KEY": "[CHAVE_API]",
    "JWT": "[TOKEN_JWT]",
    "TOKEN": "[TOKEN]",
    "CREDIT_CARD": "[CARTÃO]",
    "RG": "[RG]",
    "CNH": "[CNH]",
    "OAB": "[OAB]",
    "CRM": "[CRM]",
    "PLACA": "[PLACA]",
    "PERSON": "[PESSOA]",
    "LOCATION": "[LOCAL]",
    "ORGANIZATION": "[ORGANIZACAO]",
}


def rewrite_pii_tokens(text: str, entities: list) -> str:
    """
    Reescreve PII com tokens semânticos ([CPF], [CARTÃO], …).

    Lida com spans SOBREPOSTOS (comum: NER do spaCy + recognizer de regex marcam
    a mesma região) — funde spans que se tocam/cruzam antes de substituir, para
    não corromper o texto (bug: "RG 12.345.678-9" virava "[ORGANIZATION]G]").
    """
    spans = []
    for e in entities:
        try:
            start = int(e.get("start", 0))
            end = int(e.get("end", 0))
        except (TypeError, ValueError):
            continue
        if end <= start or start < 0 or end > len(text):
            continue
        spans.append((start, end, e.get("type", "UNKNOWN")))

    if not spans:
        return text

    # funde sobreposições: ordena por início, junta o que cruza/toca
    spans.sort(key=lambda s: (s[0], s[1]))
    merged: list[list] = []
    for start, end, etype in spans:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
            # mantém o tipo mais "forte" (o de credencial/documento ganha do NER genérico)
            if merged[-1][2] in ("PERSON", "LOCATION", "ORGANIZATION") and etype not in ("PERSON", "LOCATION", "ORGANIZATION"):
                merged[-1][2] = etype
        else:
            merged.append([start, end, etype])

    # substitui de trás pra frente para não deslocar posições
    result = text
    for start, end, etype in reversed(merged):
        token = _TOKEN_MAP.get(etype, f"[{etype}]")
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
            for entity in (entities or []):
                if isinstance(entity, dict):
                    entity_list.append(entity)
                else:
                    # presidio RecognizerResult: sem .text — fatiar do texto original
                    start = getattr(entity, "start", 0)
                    end = getattr(entity, "end", 0)
                    entity_list.append({
                        "type": getattr(entity, "entity_type", "UNKNOWN"),
                        "value": input_text[start:end],
                        "start": start,
                        "end": end,
                    })

            if entity_list:
                rewritten = rewrite_pii_tokens(input_text, entity_list)
                result["rewritten_text"] = rewritten
                result["applied"] = True
                result["sanitized"] = True
                _log_event("dlp_strict_applied", {
                    "original_length": len(input_text),
                    "rewritten_length": len(rewritten),
                    "entity_count": len(entity_list),
                    "entity_types": [e.get("type") for e in entity_list],
                })
            else:
                # HIGH risk mas sem entidades posicionais → fallback pelo scanner regex
                rewritten = _fallback_redact(input_text)
                result["rewritten_text"] = rewritten
                result["applied"] = rewritten != input_text
                result["sanitized"] = result["applied"]
                _log_event("dlp_strict_applied_fallback", {"reason": "no_positional_entities"})
        except Exception as e:
            # STRICT mode: NUNCA enviar PII crua ao LLM. Fail-safe = redação crua.
            fallback = _fallback_redact(input_text)
            result["rewritten_text"] = fallback
            result["applied"] = fallback != input_text
            result["sanitized"] = result["applied"]
            _log_event("dlp_strict_error", {
                "error": str(e),
                "risk_level": server_risk,
                "fallback_applied": result["applied"],
            })
    else:
        # Modo observação: registra o que TERIA feito
        _log_event("dlp_strict_would_apply", {
            "risk_level": server_risk,
            "entities": server_dlp_metadata.get("dlp_entity_types", []),
        })

    return result


def _fallback_redact(text: str) -> str:
    """
    Redação crua para STRICT mode quando o rewrite posicional falha.
    Usa o scanner regex (dlp/scanner.py) — nunca deixa PII crua passar.
    """
    try:
        from .scanner import scan
        return scan(text).masked_content or text
    except Exception:
        return text


def _log_event(event_type: str, data: dict) -> None:
    """Registra evento estruturado para auditoria."""
    event = {
        "event": event_type,
        **data,
    }
    print(json.dumps(event), flush=True)
