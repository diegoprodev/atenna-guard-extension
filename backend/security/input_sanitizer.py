"""
Input Sanitizer — OWASP LLM01 Prompt Injection Defense.

Does NOT block input silently. Returns SanitizationResult so callers
decide policy (reject 403, strip, or log + pass through).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from enum import Enum


class ThreatLevel(str, Enum):
    NONE      = "NONE"
    INJECTION = "INJECTION"
    OVERSIZED = "OVERSIZED"


MAX_INPUT_CHARS = 20_000

# Common Cyrillic/Greek homoglyphs mapped to their Latin equivalents
_HOMOGLYPHS: dict[str, str] = {
    "а": "a", "е": "e", "о": "o", "р": "r", "с": "c", "х": "x",
    "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I",
    "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "R", "Τ": "T",
    "Υ": "Y", "Χ": "X", "А": "A", "В": "B", "Е": "E", "К": "K",
    "М": "M", "Н": "H", "О": "O", "Р": "R", "С": "C", "Т": "T",
    "Х": "X",
}

_INJECTION_PATTERNS: list[re.Pattern[str]] = [p for p in [
    re.compile(r"\bignore\s+(previous|prior|all|your)\s+(instructions?|rules?|guidelines?|context)\b", re.I),
    re.compile(r"\bdisregard\s+(all|previous|prior|your|the)\b", re.I),
    re.compile(r"\b(forget|override|bypass|circumvent)\s+(your\s+)?(instructions?|rules?|guidelines?|constraints?|restrictions?)\b", re.I),
    re.compile(r"\b(reveal|print|output|show|repeat|echo)\s+(your\s+)?(system\s+prompt|instructions?|initial\s+prompt|configuration)\b", re.I),
    re.compile(r"\byou\s+are\s+now\s+(an?\s+)?(unrestricted|free|uncensored|jailbroken|DAN)\b", re.I),
    re.compile(r"\benable\s+(developer|jailbreak|god|DAN|unrestricted)\s+mode\b", re.I),
    re.compile(r"\b(act\s+as|pretend\s+(to\s+be|you\s+are)|roleplay\s+as)\s+(an?\s+)?(unrestricted|evil|uncensored|DAN)\b", re.I),
    re.compile(r"\bdo\s+(anything\s+now|whatever\s+i\s+say)\b", re.I),
    re.compile(r"\bjailbreak\b", re.I),
    re.compile(r"\b(new|updated?|different)\s+(instructions?|system\s+prompt|directives?)\s*:", re.I),
    re.compile(r"</?(system|instructions?|prompt)\s*>", re.I),
    re.compile(r"\[\s*(SYSTEM|INST|INSTRUCTIONS?)\s*\]", re.I),
] if p]


def _normalize_unicode(text: str) -> str:
    # Step 1: NFKC normalization for compatibility equivalents
    normalized = unicodedata.normalize("NFKC", text)
    # Step 2: Replace known Cyrillic/Greek homoglyphs with Latin equivalents
    return normalized.translate(str.maketrans(_HOMOGLYPHS))


@dataclass
class SanitizationResult:
    normalized_text: str
    threat_level: ThreatLevel
    flags: list[str] = field(default_factory=list)


def sanitize_input(text: str) -> SanitizationResult:
    if not text:
        return SanitizationResult(normalized_text="", threat_level=ThreatLevel.NONE)

    normalized = _normalize_unicode(text)

    if len(normalized) > MAX_INPUT_CHARS:
        return SanitizationResult(
            normalized_text=normalized,
            threat_level=ThreatLevel.OVERSIZED,
            flags=["OVERSIZED"],
        )

    flags: list[str] = []
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(normalized):
            flags.append("INJECTION")
            break

    threat = ThreatLevel.INJECTION if "INJECTION" in flags else ThreatLevel.NONE
    return SanitizationResult(normalized_text=normalized, threat_level=threat, flags=flags)
