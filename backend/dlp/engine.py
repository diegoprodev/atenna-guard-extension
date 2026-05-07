"""
Shared DLP Engine — Single source of truth for all analysis.

Used by:
- /dlp/scan endpoint
- /generate-prompts revalidation
- strict mode enforcement

NO HTTP internal calls. Single instance, shared context.
"""

from __future__ import annotations

import json
import re
import time
from typing import Optional
from dataclasses import dataclass

from .analyzer import analyze
from .scoring import score_results
from . import telemetry


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
    protected_tokens_detected: bool  # True if [CPF], [EMAIL], etc detected
    was_rewritten: bool  # True if input was already rewritten


@dataclass
class MismatchReport:
    """Report of client vs server divergence."""
    has_mismatch: bool
    client_risk: str
    server_risk: str
    client_entity_count: int
    server_entity_count: int
    divergence_type: Optional[str]  # "client_low_server_high", etc
    confidence: float  # 0-1


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

    def analyze(
        self,
        text: str,
        source: str = "server",
        client_metadata: Optional[dict] = None,
        session_id: Optional[str] = None,
    ) -> AnalysisResult:
        """
        Analyze text and return analysis result.

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
            # Run Presidio analysis
            entities = analyze(text)
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

            # Log telemetry
            if session_id:
                telemetry.engine_analyzed(
                    session_id=session_id,
                    source=source,
                    risk_level=risk_level,
                    entity_count=len(entities),
                    duration_ms=duration_ms,
                )

            return result

        except Exception as e:
            # Fail-safe: return NONE risk
            duration_ms = (time.perf_counter() - t0) * 1000
            return AnalysisResult(
                risk_level="NONE",
                score=0,
                entities=[],
                entity_types=[],
                duration_ms=duration_ms,
                source=source,
                text_hash=text_hash,
                protected_tokens_detected=protected_detected,
                was_rewritten=was_rewritten,
            )

    def revalidate(
        self,
        text: str,
        client_metadata: dict,
        session_id: Optional[str] = None,
    ) -> tuple[AnalysisResult, MismatchReport]:
        """
        Revalidate server-side and compare with client findings.

        Args:
            text: Original input text
            client_metadata: Client-side findings
            session_id: For telemetry

        Returns:
            (server_analysis, mismatch_report)
        """
        # Server-side analysis
        server_result = self.analyze(
            text,
            source="server",
            client_metadata=client_metadata,
            session_id=session_id,
        )

        # Compare with client
        mismatch = self._compare_findings(
            client_metadata,
            server_result,
        )

        # Log mismatch if detected
        if mismatch.has_mismatch and session_id:
            telemetry.mismatch_detected(
                session_id=session_id,
                divergence_type=mismatch.divergence_type,
                client_risk=mismatch.client_risk,
                server_risk=mismatch.server_risk,
                confidence=mismatch.confidence,
            )

        return server_result, mismatch

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
        """
        Compare client vs server findings.

        Detect:
        - CLIENT LOW + SERVER HIGH
        - CLIENT NONE + SERVER HIGH
        - CLIENT HIGH + SERVER NONE (unusual but possible)
        """
        client_risk = client_metadata.get("dlp_risk_level", "NONE")
        client_count = client_metadata.get("dlp_entity_count", 0)

        server_risk = server_result.risk_level
        server_count = len(server_result.entities)

        # Determine divergence type
        divergence_type = None
        confidence = 0.0

        risk_hierarchy = {"NONE": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}
        client_rank = risk_hierarchy.get(client_risk, 0)
        server_rank = risk_hierarchy.get(server_risk, 0)

        if client_rank < server_rank:
            # Client underestimated
            divergence_type = "client_low_server_high"
            # Confidence based on gap: NONE→HIGH is high confidence
            confidence = min((server_rank - client_rank) / 3.0, 1.0)

        elif client_rank > server_rank:
            # Client overestimated (unusual)
            divergence_type = "client_high_server_low"
            confidence = 0.5  # Lower confidence for client overestimate

        elif client_count != server_count and server_count > 0:
            # Same risk but different entity counts
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


def analyze(
    text: str,
    source: str = "server",
    client_metadata: Optional[dict] = None,
    session_id: Optional[str] = None,
) -> AnalysisResult:
    """Convenience function to use global engine."""
    return get_engine().analyze(
        text,
        source=source,
        client_metadata=client_metadata,
        session_id=session_id,
    )


def revalidate(
    text: str,
    client_metadata: dict,
    session_id: Optional[str] = None,
) -> tuple[AnalysisResult, MismatchReport]:
    """Convenience function to use global engine."""
    return get_engine().revalidate(
        text,
        client_metadata=client_metadata,
        session_id=session_id,
    )
