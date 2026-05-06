"""
Presidio-based analyzer with Brazilian PII support.
Lazy-loaded: first call initializes the engine to avoid startup latency.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Optional

from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider


# ── Custom Brazilian recognizers ─────────────────────────────

class CPFRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="BR_CPF",
            patterns=[Pattern("CPF", r"\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b", 0.85)],
            context=["cpf", "cadastro de pessoa", "cadastro"],
        )

    def validate_result(self, pattern_text: str) -> Optional[bool]:
        digits = re.sub(r"\D", "", pattern_text)
        if len(digits) != 11 or digits == digits[0] * 11:
            return False
        # Check digits validation
        for i in range(9, 11):
            total = sum(int(digits[j]) * (i + 1 - j) for j in range(i))
            expected = (total * 10 % 11) % 10
            if int(digits[i]) != expected:
                return False
        return True


class CNPJRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="BR_CNPJ",
            patterns=[Pattern("CNPJ", r"\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b", 0.85)],
            context=["cnpj", "empresa", "razão social"],
        )


class BRPhoneRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="BR_PHONE",
            patterns=[Pattern("BR_PHONE", r"(\+55\s?)?(\(?\d{2}\)?\s?)[\s9]?\d{4,5}[-\s]?\d{4}\b", 0.75)],
            context=["telefone", "celular", "fone", "whatsapp", "contato"],
        )


class APIKeyRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="API_KEY",
            patterns=[
                Pattern("SK_LIVE",   r"\bsk_live_[A-Za-z0-9_\-]{16,}", 0.99),
                Pattern("SK_TEST",   r"\bsk_test_[A-Za-z0-9_\-]{16,}", 0.99),
                Pattern("PK_LIVE",   r"\bpk_live_[A-Za-z0-9_\-]{16,}", 0.99),
                Pattern("API_KEY",   r"\bapi[_-]?key\s*[=:]\s*[A-Za-z0-9_\-]{16,}", 0.95),
                Pattern("BEARER",    r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*", 0.92),
            ],
            context=["api", "key", "token", "secret", "authorization"],
        )


# ── Engine singleton ─────────────────────────────────────────

@lru_cache(maxsize=1)
def get_analyzer() -> AnalyzerEngine:
    """Build and cache the analyzer (includes Presidio + custom recognizers)."""
    # Use a small NLP model to avoid memory overhead; spaCy en_core_web_sm
    provider = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
    })
    nlp_engine = provider.create_engine()

    engine = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en", "pt"])

    # Register custom Brazilian recognizers
    for recognizer in [CPFRecognizer(), CNPJRecognizer(), BRPhoneRecognizer(), APIKeyRecognizer()]:
        engine.registry.add_recognizer(recognizer)

    return engine


def analyze(text: str) -> list[RecognizerResult]:
    """Run full Presidio analysis. Returns raw recognizer results."""
    if not text or len(text.strip()) < 4:
        return []
    analyzer = get_analyzer()
    return analyzer.analyze(text=text, language="pt")
