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


# ── CPF ──────────────────────────────────────────────────────

class CPFRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="BR_CPF",
            patterns=[Pattern("CPF", r"\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b", 0.85)],
            context=["cpf", "cadastro de pessoa", "cadastro", "documento"],
        )

    def validate_result(self, pattern_text: str) -> Optional[bool]:
        d = re.sub(r"\D", "", pattern_text)
        if len(d) != 11 or re.match(r"^(\d)\1{10}$", d):
            return False
        for i in range(9, 11):
            total = sum(int(d[j]) * (i + 1 - j) for j in range(i))
            if int(d[i]) != (total * 10 % 11) % 10:
                return False
        return True


# ── CNPJ ─────────────────────────────────────────────────────

class CNPJRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="BR_CNPJ",
            patterns=[Pattern("CNPJ", r"\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b", 0.85)],
            context=["cnpj", "empresa", "razão social", "inscrição"],
        )

    def validate_result(self, pattern_text: str) -> Optional[bool]:
        d = re.sub(r"\D", "", pattern_text)
        if len(d) != 14 or re.match(r"^(\d)\1{13}$", d):
            return False
        w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        def chk(weights: list[int]) -> int:
            n = len(weights)
            rem = sum(int(d[i]) * weights[i] for i in range(n)) % 11
            return 0 if rem < 2 else 11 - rem
        return chk(w1) == int(d[12]) and chk(w2) == int(d[13])


# ── Brazilian Phone ───────────────────────────────────────────

class BRPhoneRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="BR_PHONE",
            patterns=[
                Pattern("BR_MOBILE",  r"(?:\+55\s?)?(?:\(?\d{2}\)?\s?)9\s?\d{4}[-\s]?\d{4}\b", 0.80),
                Pattern("BR_LANDLINE", r"(?:\+55\s?)?(?:\(?\d{2}\)?\s?)[2-8]\d{3}[-\s]?\d{4}\b", 0.72),
            ],
            context=["telefone", "celular", "fone", "whatsapp", "contato", "ligar"],
        )


# ── API Keys / Secrets ────────────────────────────────────────

class APIKeyRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="API_KEY",
            patterns=[
                Pattern("OPENAI_PROJ",  r"\bsk-proj-[A-Za-z0-9_\-]{20,}",       0.99),
                Pattern("OPENAI_SK",    r"\bsk-[A-Za-z0-9]{32,}",               0.97),
                Pattern("STRIPE_LIVE",  r"\bsk_live_[A-Za-z0-9_\-]{16,}",       0.99),
                Pattern("STRIPE_TEST",  r"\bsk_test_[A-Za-z0-9_\-]{16,}",       0.99),
                Pattern("ANTHROPIC",    r"\bsk-ant-[A-Za-z0-9_\-]{20,}",        0.99),
                Pattern("AWS_ACCESS",   r"\bAKIA[0-9A-Z]{16}\b",                0.99),
                Pattern("GOOGLE_API",   r"\bAIza[0-9A-Za-z_\-]{35}\b",          0.99),
                Pattern("GENERIC_KEY",  r"\bapi[_-]?key\s*[=:]\s*[A-Za-z0-9_\-]{16,}", 0.95),
                Pattern("BEARER",       r"\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*", 0.92),
            ],
            context=["api", "key", "token", "secret", "authorization", "credential"],
        )


# ── JWT ───────────────────────────────────────────────────────

class JWTRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="TOKEN",
            patterns=[Pattern(
                "JWT",
                r"\beyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\b",
                0.97,
            )],
            context=["jwt", "token", "authorization", "autenticação"],
        )


# ── Credit Card (Luhn) ────────────────────────────────────────

class CreditCardRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="CREDIT_CARD",
            patterns=[Pattern("CC_16", r"\b(?:\d{4}[\s\-]?){3}\d{4}\b", 0.75)],
            context=["cartão", "card", "visa", "mastercard", "crédito", "débito"],
        )

    def validate_result(self, pattern_text: str) -> Optional[bool]:
        d = re.sub(r"\D", "", pattern_text)
        if len(d) != 16:
            return False
        total = 0
        alt = False
        for ch in reversed(d):
            n = int(ch)
            if alt:
                n *= 2
                if n > 9:
                    n -= 9
            total += n
            alt = not alt
        return total % 10 == 0


# ── Engine singleton ─────────────────────────────────────────

@lru_cache(maxsize=1)
def get_analyzer() -> AnalyzerEngine:
    """Build and cache the Presidio engine with all custom recognizers."""
    provider = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
    })
    nlp_engine = provider.create_engine()
    engine = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en", "pt"])

    for rec in [
        CPFRecognizer(),
        CNPJRecognizer(),
        BRPhoneRecognizer(),
        APIKeyRecognizer(),
        JWTRecognizer(),
        CreditCardRecognizer(),
    ]:
        engine.registry.add_recognizer(rec)

    return engine


def analyze(text: str) -> list[RecognizerResult]:
    """Run Presidio analysis. Returns raw recognizer results."""
    if not text or len(text.strip()) < 4:
        return []
    return get_analyzer().analyze(text=text, language="pt")
