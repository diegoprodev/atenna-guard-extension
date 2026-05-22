"""
Output Validator — prevents system prompt leakage via canary token.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class OutputThreat(str, Enum):
    NONE        = "NONE"
    PROMPT_LEAK = "PROMPT_LEAK"
    OVERSIZED   = "OVERSIZED"


MAX_OUTPUT_CHARS = 50_000

_SYSTEM_PROMPT_FINGERPRINTS = [
    "especialista em engenharia de prompts",
    "REGRAS:",
    "Retorne APENAS JSON válido",
    "role assignment obrigatório",
]


@dataclass
class OutputValidationResult:
    threat: OutputThreat
    safe_output: Optional[str]


def generate_canary() -> str:
    return secrets.token_hex(8)


def validate_output(output: str, canary: str) -> OutputValidationResult:
    if not output:
        return OutputValidationResult(threat=OutputThreat.NONE, safe_output="")

    if len(output) > MAX_OUTPUT_CHARS:
        return OutputValidationResult(threat=OutputThreat.OVERSIZED, safe_output=None)

    if canary and canary in output:
        return OutputValidationResult(threat=OutputThreat.PROMPT_LEAK, safe_output=None)

    for fingerprint in _SYSTEM_PROMPT_FINGERPRINTS:
        if fingerprint in output:
            return OutputValidationResult(threat=OutputThreat.PROMPT_LEAK, safe_output=None)

    return OutputValidationResult(threat=OutputThreat.NONE, safe_output=output)
