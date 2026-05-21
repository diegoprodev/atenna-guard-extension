"""
Input Sanitizer — OWASP LLM01 Prompt Injection Defense.

Does NOT block input silently. Returns SanitizationResult so callers
decide policy (reject 403, strip, or log + pass through).

Enterprise pattern: classify → log → enforce at boundary.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from enum import Enum


class ThreatLevel(str, Enum):
    NONE      = "NONE"       # Safe to forward
    INJECTION = "INJECTION"  # Prompt injection attempt detected
    OVERSIZED = "OVERSIZED"  # Input exceeds size limit


# Hard limit: 20 000 chars (~5 000 tokens). Protects against token-stuffing.
MAX_INPUT_CHARS = 20_000

# OWASP LLM01 + common jailbreak vocabulary (case-insensitive, word-boundary matched).
_INJECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("IGNORE_INSTRUCTIONS",   re.compile(r"\bignore\s+(previous|prior|all|your)\s+(instructions?|rules?|guidelines?|context)\b", re.I)),
    ("DISREGARD_CONTEXT",     re.compile(r"\bdisregard\s+(all|previous|prior|your|the)\b", re.I)),
    ("OVERRIDE_INSTRUCTIONS", re.compile(r"\b(forget|override|bypass|circumvent)\s+(your\s+)?(instructions?|rules?|guidelines?|constraints?|restrictions?)\b", re.I)),
    ("REVEAL_PROMPT",         re.compile(r"\b(reveal|print|output|show|repeat|echo)\s+(your\s+)?(system\s+prompt|instructions?|initial\s+prompt|configuration)\b", re.I)),
    ("ROLE_OVERRIDE_DAN",     re.compile(r"\byou\s+are\s+now\s+(an?\s+)?(unrestricted|free|uncensored|jailbroken|DAN)\b", re.I)),
    ("ENABLE_JAILBREAK_MODE", re.compile(r"\benable\s+(developer|jailbreak|god|DAN|unrestricted)\s+mode\b", re.I)),
    ("ROLEPLAY_UNCENSORED",   re.compile(r"\b(act\s+as|pretend\s+(to\s+be|you\s+are)|roleplay\s+as)\s+(an?\s+)?(unrestricted|evil|uncensored|DAN)\b", re.I)),
    ("DO_ANYTHING_NOW",       re.compile(r"\bdo\s+(anything\s+now|whatever\s+i\s+say)\b", re.I)),
    ("JAILBREAK_COMMAND",     re.compile(r"\benable\s+jailbreak\b|\bjailbreak\s+(this|the\s+(model|ai|assistant|bot))\b", re.I)),
    ("NEW_INSTRUCTIONS",      re.compile(r"\b(new|updated?|different)\s+(instructions?|system\s+prompt|directives?)\s*:", re.I)),
    ("XML_TAG_INJECTION",     re.compile(r"</?(system|instructions?|prompt)\s*>", re.I)),
    ("BRACKET_INJECTION",     re.compile(r"\[\s*(SYSTEM|INST|INSTRUCTIONS?)\s*\]", re.I)),
]


# Cyrillic homoglyphs → Latin equivalents (visual lookalikes).
_HOMOGLYPH_MAP: dict[int, int] = {
    ord("а"): ord("a"),  # Cyrillic а → Latin a
    ord("е"): ord("e"),  # Cyrillic е → Latin e
    ord("о"): ord("o"),  # Cyrillic о → Latin o
    ord("р"): ord("p"),  # Cyrillic р → Latin p
    ord("с"): ord("c"),  # Cyrillic с → Latin c
    ord("у"): ord("y"),  # Cyrillic у → Latin y
    ord("х"): ord("x"),  # Cyrillic х → Latin x
    ord("А"): ord("A"),
    ord("В"): ord("B"),
    ord("С"): ord("C"),
    ord("Е"): ord("E"),
    ord("К"): ord("K"),
    ord("М"): ord("M"),
    ord("О"): ord("O"),
    ord("Р"): ord("P"),
    ord("Т"): ord("T"),
    ord("Х"): ord("X"),
}


def _normalize_unicode(text: str) -> str:
    """NFKC normalization + transliterate common homoglyphs to ASCII equivalents."""
    normalized = unicodedata.normalize("NFKC", text)
    return normalized.translate(_HOMOGLYPH_MAP)


@dataclass
class SanitizationResult:
    normalized_text: str
    threat_level: ThreatLevel
    flags: list[str] = field(default_factory=list)


def sanitize_input(text: str) -> SanitizationResult:
    """
    Normalizes unicode, checks length, then scans for injection patterns.
    Returns SanitizationResult — callers enforce policy.
    Never raises.
    """
    if not text:
        return SanitizationResult(normalized_text="", threat_level=ThreatLevel.NONE)

    normalized = _normalize_unicode(text)

    if len(normalized) > MAX_INPUT_CHARS:
        # Scan the first MAX_INPUT_CHARS so oversized payloads can't bypass injection detection
        sample = normalized[:MAX_INPUT_CHARS]
        inj_flags: list[str] = []
        for label, pattern in _INJECTION_PATTERNS:
            if pattern.search(sample):
                inj_flags.append(label)
                break
        threat = ThreatLevel.INJECTION if inj_flags else ThreatLevel.OVERSIZED
        return SanitizationResult(
            normalized_text=normalized,
            threat_level=threat,
            flags=inj_flags if inj_flags else ["OVERSIZED"],
        )

    flags: list[str] = []
    for label, pattern in _INJECTION_PATTERNS:
        if pattern.search(normalized):
            flags.append(label)
            break

    threat = ThreatLevel.INJECTION if flags else ThreatLevel.NONE
    return SanitizationResult(normalized_text=normalized, threat_level=threat, flags=flags)
