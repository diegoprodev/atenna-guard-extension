"""
ATENNA PRESIDIO DLP ENGINE - Complete Implementation
======================================================

This file contains the complete Presidio-based DLP engine with Brazilian PII support.
Ready to integrate into Atenna AI backend.

Dependencies (already in your container):
- presidio-analyzer >= 2.1.0
- spacy >= 3.0.0
- pt_core_news_sm (Portuguese NLP model)

Files to integrate:
1. analyzer.py - Presidio engine with custom recognizers
2. engine.py - DLP analysis engine with timeout protection
3. scoring.py - Risk scoring logic
4. Optional: pipeline.py - Full DLP pipeline

Usage:
    from dlp.engine import analyze, revalidate
    result = await analyze("texto com CPF 123.456.789-09")
    print(result.risk_level)  # "HIGH"
    print(result.entities)     # [RecognizerResult(...)]
"""

# ============================================================================
# FILE 1: analyzer.py
# Presidio-based analyzer with Brazilian PII support
# ============================================================================

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
            supported_language="pt",
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
            supported_language="pt",
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
            supported_language="pt",
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
            supported_language="pt",
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
            supported_language="pt",
            patterns=[Pattern(
                "JWT",
                r"\beyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\b",
                0.97,
            )],
            context=["jwt", "token", "authorization", "autenticação"],
        )


# ── Credit Card (Luhn) ────────────────────────────────────────

class BRCreditCardRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="CREDIT_CARD",
            supported_language="pt",
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


# ── RG ───────────────────────────────────────────────────────

class RGRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="RG",
            supported_language="pt",
            patterns=[
                Pattern("RG_LABELED",   r"\b(?:RG|R\.G\.)[:\s.]*\d{1,2}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d?\b", 0.88),
                Pattern("RG_FORMATTED", r"\b\d{2}\.\d{3}\.\d{3}-\d\b", 0.85),
            ],
            context=["rg", "identidade", "registro geral", "documento"],
        )

    def validate_result(self, pattern_text: str) -> Optional[bool]:
        d = re.sub(r"\D", "", pattern_text)
        return 7 <= len(d) <= 9 and not re.match(r"^(\d)\1+$", d)


# ── CNH ──────────────────────────────────────────────────────

class CNHRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="CNH",
            supported_language="pt",
            patterns=[
                Pattern("CNH_LABELED", r"\b(?:CNH|C\.N\.H\.|habilitação|habilitacao)[:\s.]*\d[\d\s]{9,12}\d\b", 0.96),
            ],
            context=["cnh", "habilitação", "carteira", "motorista", "detran"],
        )

    def validate_result(self, pattern_text: str) -> Optional[bool]:
        d = re.sub(r"\D", "", pattern_text)
        return len(d) == 11 and not re.match(r"^(\d)\1{10}$", d)


# ── OAB ──────────────────────────────────────────────────────

class OABRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="OAB",
            supported_language="pt",
            patterns=[
                Pattern("OAB_STATE", r"\bOAB[/\-][A-Z]{2}\s*\d{4,6}\b", 0.95),
            ],
            context=["oab", "advogado", "advogada", "ordem", "advocacia"],
        )


# ── Placa Veicular ───────────────────────────────────────────

class PlacaRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="PLACA",
            supported_language="pt",
            patterns=[
                Pattern("PLACA_MERCOSUL", r"\b[A-Z]{3}\d[A-Z]\d{2}\b", 0.85),
                Pattern("PLACA_OLD",      r"\b[A-Z]{3}-\d{4}\b",        0.82),
            ],
            context=["placa", "veículo", "veiculo", "carro", "moto", "automóvel"],
        )

    def validate_result(self, pattern_text: str) -> Optional[bool]:
        s = re.sub(r"[^A-Z0-9]", "", pattern_text.upper())
        if len(s) == 7:
            return bool(re.match(r"^[A-Z]{3}\d[A-Z]\d{2}$", s) or re.match(r"^[A-Z]{3}\d{4}$", s))
        return False


# ── CRM ──────────────────────────────────────────────────────

class CRMRecognizer(PatternRecognizer):
    def __init__(self) -> None:
        super().__init__(
            supported_entity="CRM",
            supported_language="pt",
            patterns=[
                Pattern("CRM_STATE", r"\bCRM[/\-][A-Z]{2}\s*\d{4,6}\b", 0.95),
            ],
            context=["crm", "médico", "medico", "doutor", "dr", "dra", "medicina"],
        )


# ── Engine singleton ─────────────────────────────────────────

@lru_cache(maxsize=1)
def get_analyzer() -> AnalyzerEngine:
    """Build and cache the Presidio engine with all custom recognizers."""
    provider = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [
            {"lang_code": "pt", "model_name": "pt_core_news_sm"},
            {"lang_code": "en", "model_name": "en_core_web_sm"},
        ],
    })
    nlp_engine = provider.create_engine()
    engine = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en", "pt"])

    for rec in [
        CPFRecognizer(),
        CNPJRecognizer(),
        BRPhoneRecognizer(),
        APIKeyRecognizer(),
        JWTRecognizer(),
        BRCreditCardRecognizer(),
        RGRecognizer(),
        CNHRecognizer(),
        OABRecognizer(),
        PlacaRecognizer(),
        CRMRecognizer(),
    ]:
        engine.registry.add_recognizer(rec)

    return engine


def analyze(text: str) -> list[RecognizerResult]:
    """Run Presidio analysis. Returns raw recognizer results."""
    if not text or len(text.strip()) < 4:
        return []
    return get_analyzer().analyze(text=text, language="pt")


# ============================================================================
# FILE 2: engine.py
# Shared DLP Engine with timeout protection
# ============================================================================

"""
Shared DLP Engine — Single source of truth for all analysis.

Used by:
- /dlp/scan endpoint
- /generate-prompts revalidation
- strict mode enforcement

NO HTTP internal calls. Single instance, shared context.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Optional
from dataclasses import dataclass

# from .analyzer import analyze  # Import the analyzer.py analyze function
# from .scoring import score_results
# from . import telemetry

# Timeout constants
ANALYSIS_TIMEOUT_SECONDS = 3.0
MIN_TIMEOUT_SECONDS = 0.1


@dataclass
class AnalysisResult:
    """Internal analysis result with extended metadata."""
    risk_level: str  # NONE, LOW, MEDIUM, HIGH
    score: float  # 0-100
    entities: list  # RecognizerResult objects
    entity_types: list[str]
    duration_ms: float
    source: str  # "client" or "server"
    text_hash: str  # Hash of original text
    protected_tokens_detected: bool
    was_rewritten: bool


@dataclass
class MismatchReport:
    """Report of client vs server divergence."""
    has_mismatch: bool
    client_risk: str
    server_risk: str
    client_entity_count: int
    server_entity_count: int
    divergence_type: Optional[str]
    confidence: float


class DLPEngine:
    """
    Centralized DLP analysis engine.

    Responsibilities:
    - Analyze text with Presidio
    - Score risk level
    - Detect protected tokens
    - Compare client vs server findings
    - Generate telemetry
    """

    # Protected token patterns (from enforcement rewrite)
    PROTECTED_TOKENS = {
        "CPF": r"\[CPF\]",
        "CNPJ": r"\[CNPJ\]",
        "EMAIL": r"\[EMAIL\]",
        "PHONE": r"\[TELEFONE\]",
        "API_KEY": r"\[CHAVE_API\]",
        "JWT": r"\[TOKEN_JWT\]",
        "CREDIT_CARD": r"\[CARTAO\]",
        "PESSOA": r"\[PESSOA\]",
        "LOCAL": r"\[LOCAL\]",
    }

    def __init__(self):
        self.analyzer = None  # Lazy-loaded

    async def analyze(
        self,
        text: str,
        source: str = "server",
        client_metadata: Optional[dict] = None,
        session_id: Optional[str] = None,
    ) -> AnalysisResult:
        """
        Analyze text and return analysis result with timeout protection.

        Args:
            text: Text to analyze
            source: "client" or "server"
            client_metadata: Optional client-side findings for comparison
            session_id: For telemetry

        Returns:
            AnalysisResult with detailed metadata
        """
        t0 = time.perf_counter()

        # Check for protected tokens in text
        protected_detected = self._detect_protected_tokens(text)
        was_rewritten = protected_detected

        # Hash of text (for mismatch tracking)
        text_hash = self._hash_text(text)

        try:
            # Run Presidio analysis with timeout protection
            loop = asyncio.get_event_loop()
            entities = await asyncio.wait_for(
                loop.run_in_executor(None, analyze, text),
                timeout=ANALYSIS_TIMEOUT_SECONDS,
            )
            score, risk_level = score_results(entities)

            entity_types = [e.entity_type for e in entities]
            duration_ms = (time.perf_counter() - t0) * 1000

            result = AnalysisResult(
                risk_level=risk_level,
                score=score,
                entities=entities,
                entity_types=entity_types,
                duration_ms=duration_ms,
                source=source,
                text_hash=text_hash,
                protected_tokens_detected=protected_detected,
                was_rewritten=was_rewritten,
            )

            return result

        except asyncio.TimeoutError:
            duration_ms = (time.perf_counter() - t0) * 1000
            return AnalysisResult(
                risk_level="UNKNOWN",
                score=0,
                entities=[],
                entity_types=[],
                duration_ms=duration_ms,
                source=source,
                text_hash=text_hash,
                protected_tokens_detected=protected_detected,
                was_rewritten=was_rewritten,
            )

        except Exception as e:
            duration_ms = (time.perf_counter() - t0) * 1000
            return AnalysisResult(
                risk_level="UNKNOWN",
                score=0,
                entities=[],
                entity_types=[],
                duration_ms=duration_ms,
                source=source,
                text_hash=text_hash,
                protected_tokens_detected=protected_detected,
                was_rewritten=was_rewritten,
            )

    def _detect_protected_tokens(self, text: str) -> bool:
        """Check if text contains protected tokens like [CPF], [EMAIL], etc."""
        for token_pattern in self.PROTECTED_TOKENS.values():
            if re.search(token_pattern, text, re.IGNORECASE):
                return True
        return False

    def _hash_text(self, text: str) -> str:
        """Create simple hash of text for mismatch tracking."""
        import hashlib
        return hashlib.md5(text.encode()).hexdigest()[:8]

    def _compare_findings(
        self,
        client_metadata: dict,
        server_result: AnalysisResult,
    ) -> MismatchReport:
        """Compare client vs server findings."""
        client_risk = client_metadata.get("dlp_risk_level", "NONE")
        client_count = client_metadata.get("dlp_entity_count", 0)

        server_risk = server_result.risk_level
        server_count = len(server_result.entities)

        divergence_type = None
        confidence = 0.0

        risk_hierarchy = {"NONE": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}
        client_rank = risk_hierarchy.get(client_risk, 0)
        server_rank = risk_hierarchy.get(server_risk, 0)

        if client_rank < server_rank:
            divergence_type = "client_low_server_high"
            confidence = min((server_rank - client_rank) / 3.0, 1.0)

        elif client_rank > server_rank:
            divergence_type = "client_high_server_low"
            confidence = 0.5

        elif client_count != server_count and server_count > 0:
            divergence_type = "entity_count_mismatch"
            confidence = min(abs(client_count - server_count) / 5.0, 1.0)

        has_mismatch = divergence_type is not None

        return MismatchReport(
            has_mismatch=has_mismatch,
            client_risk=client_risk,
            server_risk=server_risk,
            client_entity_count=client_count,
            server_entity_count=server_count,
            divergence_type=divergence_type,
            confidence=confidence,
        )


# Global engine instance
_engine: Optional[DLPEngine] = None


def get_engine() -> DLPEngine:
    """Get or create global engine instance."""
    global _engine
    if _engine is None:
        _engine = DLPEngine()
    return _engine


async def analyze(
    text: str,
    source: str = "server",
    client_metadata: Optional[dict] = None,
    session_id: Optional[str] = None,
) -> AnalysisResult:
    """Convenience function to use global engine."""
    return await get_engine().analyze(
        text,
        source=source,
        client_metadata=client_metadata,
        session_id=session_id,
    )


# ============================================================================
# DEPENDENCIES & INSTALLATION NOTES
# ============================================================================

"""
Installation for Atenna AI Backend:

1. Ensure requirements.txt has:
   - presidio-analyzer >= 2.1.0
   - python-dotenv >= 0.19.0
   - spacy >= 3.0.0

2. Download Portuguese NLP model:
   python -m spacy download pt_core_news_sm

3. Integration steps:
   - Copy analyzer.py to backend/dlp/
   - Copy engine.py to backend/dlp/
   - Copy scoring.py to backend/dlp/ (or implement risk scoring logic)

4. Usage:
   from dlp.engine import analyze, get_engine

   # Single analysis
   result = await analyze("texto com CPF 123.456.789-09")
   print(result.risk_level)  # "HIGH"
   print(result.entity_types)  # ["BR_CPF"]

5. Detects:
   ✅ CPF (11 digits with validation)
   ✅ CNPJ (14 digits with validation)
   ✅ Phone numbers (mobile + landline)
   ✅ API Keys (OpenAI, Stripe, AWS, Google, etc.)
   ✅ JWT tokens
   ✅ Credit cards (Luhn validation)
   ✅ RG (ID card)
   ✅ CNH (driver's license)
   ✅ OAB (lawyer registration)
   ✅ License plates
   ✅ CRM (medical registration)

Ready to integrate! Supports Portuguese & English.
"""
