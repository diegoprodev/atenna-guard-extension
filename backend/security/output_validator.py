"""
Output Validator — prevents system prompt leakage via canary token.

Pattern: generate_canary() is called once per request and embedded in the
system prompt. After the model responds, validate_output() checks the response
does NOT contain the canary. If it does, the model was jailbroken into echoing
its instructions — the response is suppressed.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class OutputThreat(str, Enum):
    NONE        = "NONE"         # Output is safe to return
    PROMPT_LEAK = "PROMPT_LEAK"  # Model echoed system prompt or canary
    OVERSIZED   = "OVERSIZED"    # Output exceeds size limit


# Max output: ~12 500 tokens at 4 chars/token
MAX_OUTPUT_CHARS = 50_000

# Fragments of the system prompt that would confirm leakage if echoed.
# Keep specific enough to avoid false positives on user text.
_SYSTEM_PROMPT_FINGERPRINTS = [
    "especialista em engenharia de prompts",
    "REGRAS:",
    "Retorne APENAS JSON válido",
    "role assignment obrigatório",
]


@dataclass
class OutputValidationResult:
    threat: OutputThreat
    safe_output: Optional[str]   # None when threat != NONE (suppressed)


def generate_canary() -> str:
    """Returns a cryptographically random 16-char hex token, unique per request."""
    return secrets.token_hex(8)  # 16 hex chars, 2^64 entropy


def validate_output(output: str, canary: str) -> OutputValidationResult:
    """
    Validates model output:
    1. Checks length
    2. Checks for canary token (direct leak)
    3. Checks for system prompt fingerprints (indirect leak)

    Returns OutputValidationResult. Callers must check .threat before using .safe_output.
    """
    if not output:
        return OutputValidationResult(threat=OutputThreat.NONE, safe_output="")

    if len(output) > MAX_OUTPUT_CHARS:
        return OutputValidationResult(threat=OutputThreat.OVERSIZED, safe_output=None)

    # Canary check — highest confidence signal
    if canary and canary in output:
        return OutputValidationResult(threat=OutputThreat.PROMPT_LEAK, safe_output=None)

    # System prompt fingerprint check
    for fingerprint in _SYSTEM_PROMPT_FINGERPRINTS:
        if fingerprint in output:
            return OutputValidationResult(threat=OutputThreat.PROMPT_LEAK, safe_output=None)

    return OutputValidationResult(threat=OutputThreat.NONE, safe_output=output)
