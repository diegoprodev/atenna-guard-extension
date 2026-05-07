"""
TASK 7: Secure Telemetry Persistence Validation

Tests for:
- Zero payload leakage
- Exception sanitization
- PII pattern detection
- LGPD compliance
- Safe analytics
"""

import pytest
import json
from datetime import datetime, timezone
import sys
import os

# Add backend dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dlp.telemetry_persistence import (
    hash_payload,
    TelemetryEvent,
    TelemetryPersistence,
    persist_event,
    get_persistence,
)
from dlp.exception_sanitizer import sanitize_exception_message, sanitize_exception_traceback


class TestPayloadHashing:
    """Validate deterministic hashing."""

    def test_hash_consistency(self):
        """Same payload always produces same hash."""
        payload = "CPF: 050.423.674-11 - Confidential"
        hash1 = hash_payload(payload)
        hash2 = hash_payload(payload)
        assert hash1 == hash2
        assert len(hash1) == 16  # SHA-256[:16]

    def test_hash_empty_payload(self):
        """Empty payload returns empty string."""
        assert hash_payload("") == ""
        assert hash_payload(None) == ""

    def test_hash_different_payload(self):
        """Different payloads produce different hashes."""
        hash1 = hash_payload("payload1")
        hash2 = hash_payload("payload2")
        assert hash1 != hash2


class TestTelemetryEventSchema:
    """Validate safe event schema."""

    def test_safe_fields_only(self):
        """Event allows only safe fields."""
        event = TelemetryEvent(
            event_type="dlp_scan_complete",
            timestamp=1234567890.0,
            payload_hash="abc123",
            risk_level="HIGH",
            entity_types=["BR_CPF", "EMAIL"],
            entity_count=2,
            was_rewritten=True,
            had_mismatch=False,
            timeout_occurred=False,
            error_occurred=False,
            duration_ms=45.5,
            score=95.0,
            source="client",
            endpoint="/scan",
            session_id="sess_123",
            user_id="user_456",
        )

        assert event.event_type == "dlp_scan_complete"
        assert event.risk_level == "HIGH"
        assert event.entity_types == ["BR_CPF", "EMAIL"]
        assert event.score == 95.0
        assert event.created_at is None  # Not set yet

    def test_no_payload_text_field(self):
        """Event schema has no payload_text field."""
        event_dict = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="hash",
        ).to_dict()

        assert "payload_text" not in event_dict
        assert "payload" not in event_dict
        assert "raw_content" not in event_dict

    def test_entity_types_not_values(self):
        """Event stores entity types, not values."""
        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="hash",
            entity_types=["BR_CPF", "EMAIL"],  # Types only
            entity_count=2,
        )

        event_dict = event.to_dict()
        assert event_dict["entity_types"] == ["BR_CPF", "EMAIL"]

        # Verify no actual CPF or email stored
        event_json = event.to_json()
        assert "050.423.674" not in event_json
        assert "@" not in event_json


class TestSensitiveDataDetection:
    """Validate PII pattern detection."""

    def test_cpf_detection(self):
        """CPF patterns are detected and rejected."""
        persistence = TelemetryPersistence()

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="hash",
            source="050.423.674-11",  # CPF in source field
        )

        result = persistence.persist(event)
        assert result is False  # Rejected due to CPF

    def test_cnpj_detection(self):
        """CNPJ patterns are detected and rejected."""
        persistence = TelemetryPersistence()

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="hash",
            endpoint="12.345.678/0001-99",  # CNPJ in endpoint
        )

        result = persistence.persist(event)
        assert result is False

    def test_api_key_detection(self):
        """API key patterns are detected and rejected."""
        persistence = TelemetryPersistence()

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="hash",
            source="sk-ant-v3aBcDefGhijKlmnOp_1234567890",
        )

        result = persistence.persist(event)
        assert result is False

    def test_bearer_token_detection(self):
        """Bearer token patterns are detected and rejected."""
        persistence = TelemetryPersistence()

        jwt_token = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="hash",
            endpoint=jwt_token,
        )

        result = persistence.persist(event)
        assert result is False

    def test_email_detection(self):
        """Email patterns are detected and rejected."""
        persistence = TelemetryPersistence()

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="hash",
            user_id="diego@atenna.ai",
        )

        result = persistence.persist(event)
        assert result is False

    def test_safe_event_accepted(self):
        """Events with safe data are accepted."""
        persistence = TelemetryPersistence()

        event = TelemetryEvent(
            event_type="dlp_scan_complete",
            timestamp=123.0,
            payload_hash="abc123def456",
            risk_level="HIGH",
            entity_types=["BR_CPF", "EMAIL"],
            entity_count=2,
            source="client",
            endpoint="/scan",
            session_id="sess_abc123",
            user_id="user_123",
        )

        result = persistence.persist(event)
        assert result is True
        assert len(persistence.events) == 1


class TestExceptionSanitization:
    """Validate exception message sanitization."""

    def test_cpf_sanitization(self):
        """CPF in exception message is sanitized."""
        exc_message = "Error processing CPF 050.423.674-11 for user"
        sanitized = sanitize_exception_message(exc_message)
        assert "050.423.674-11" not in sanitized
        assert "[CPF]" in sanitized

    def test_email_sanitization(self):
        """Email in exception message is sanitized."""
        exc_message = "Could not send email to diego@atenna.ai"
        sanitized = sanitize_exception_message(exc_message)
        assert "diego@atenna.ai" not in sanitized
        assert "[EMAIL]" in sanitized

    def test_api_key_sanitization(self):
        """API key in exception message is sanitized."""
        exc_message = "Failed with API key sk-ant-v3aBcDefGhijKlmnOp_1234567890"
        sanitized = sanitize_exception_message(exc_message)
        assert "sk-ant-" not in sanitized
        assert "[API_KEY]" in sanitized

    def test_phone_sanitization(self):
        """Phone number in exception message is sanitized."""
        exc_message = "Contact +55 (11) 98765-4321 for support"
        sanitized = sanitize_exception_message(exc_message)
        assert "98765-4321" not in sanitized
        assert "[PHONE]" in sanitized

    def test_exception_traceback_safe(self):
        """Exception traceback extraction is safe."""
        exc = ValueError("Invalid CPF: 050.423.674-11")
        safe_info = sanitize_exception_traceback(exc)

        assert safe_info["type"] == "ValueError"
        assert safe_info["sanitized"] is True
        assert "050.423.674-11" not in safe_info["message"]
        assert "[CPF]" in safe_info["message"]


class TestPersistenceOperations:
    """Validate persistence layer."""

    def test_persist_with_timestamp(self):
        """Persisted event gets timestamp."""
        persistence = TelemetryPersistence()

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="hash",
        )

        before = datetime.now(timezone.utc)
        result = persistence.persist(event)
        after = datetime.now(timezone.utc)

        assert result is True
        assert event.created_at is not None
        assert before <= event.created_at <= after

    def test_get_events_all(self):
        """Can retrieve all persisted events."""
        persistence = TelemetryPersistence()

        for i in range(3):
            event = TelemetryEvent(
                event_type=f"event_{i}",
                timestamp=float(i),
                payload_hash=f"hash_{i}",
            )
            persistence.persist(event)

        events = persistence.get_events()
        assert len(events) == 3

    def test_get_events_by_session(self):
        """Can filter events by session."""
        persistence = TelemetryPersistence()

        event1 = TelemetryEvent(
            event_type="test1",
            timestamp=1.0,
            payload_hash="h1",
            session_id="sess_a",
        )
        event2 = TelemetryEvent(
            event_type="test2",
            timestamp=2.0,
            payload_hash="h2",
            session_id="sess_b",
        )

        persistence.persist(event1)
        persistence.persist(event2)

        events_a = persistence.get_events(session_id="sess_a")
        assert len(events_a) == 1
        assert events_a[0].session_id == "sess_a"

    def test_aggregate_stats(self):
        """Aggregate statistics are safe and accurate."""
        persistence = TelemetryPersistence()

        persistence.persist(TelemetryEvent(
            event_type="scan",
            timestamp=1.0,
            payload_hash="h1",
            risk_level="HIGH",
            entity_types=["BR_CPF"],
            timeout_occurred=False,
        ))

        persistence.persist(TelemetryEvent(
            event_type="scan",
            timestamp=2.0,
            payload_hash="h2",
            risk_level="NONE",
            entity_types=["BR_CPF", "EMAIL"],
            timeout_occurred=False,
        ))

        persistence.persist(TelemetryEvent(
            event_type="timeout",
            timestamp=3.0,
            payload_hash="h3",
            risk_level="UNKNOWN",
            timeout_occurred=True,
        ))

        stats = persistence.get_aggregate_stats()

        assert stats["total_events"] == 3
        assert stats["by_risk_level"]["HIGH"] == 1
        assert stats["by_risk_level"]["NONE"] == 1
        assert stats["by_risk_level"]["UNKNOWN"] == 1
        assert stats["by_entity_type"]["BR_CPF"] == 2
        assert stats["by_entity_type"]["EMAIL"] == 1
        assert stats["timeout_rate"] == 1/3


class TestConvenienceFunction:
    """Validate convenience function."""

    def test_persist_event_function(self):
        """persist_event convenience function works."""
        # Reset global instance
        from dlp import telemetry_persistence
        telemetry_persistence._persistence = None

        result = persist_event(
            event_type="dlp_scan_complete",
            risk_level="MEDIUM",
            entity_types=["EMAIL"],
            entity_count=1,
            payload_text="Some text with email@example.com",
            was_rewritten=True,
            duration_ms=45.5,
            source="server",
            endpoint="/scan",
            session_id="sess_123",
        )

        assert result is True

        persistence = get_persistence()
        events = persistence.get_events()
        assert len(events) == 1
        assert events[0].event_type == "dlp_scan_complete"
        assert events[0].risk_level == "MEDIUM"
        assert events[0].was_rewritten is True

        # Verify payload hash was computed
        assert len(events[0].payload_hash) == 16


class TestNoPayloadLeakage:
    """Critical test: Verify zero payload in persistence."""

    def test_no_raw_payload_stored(self):
        """Raw payload text is never stored."""
        persistence = TelemetryPersistence()

        sensitive_payload = "CPF: 050.423.674-11\nEmail: diego@atenna.ai\nAPI: sk-ant-xyz"

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash=hash_payload(sensitive_payload),
            entity_types=["BR_CPF", "EMAIL", "API_KEY"],
            entity_count=3,
        )

        persistence.persist(event)

        # Get event from storage
        stored_event = persistence.events[0]
        stored_json = stored_event.to_json()

        # Verify no sensitive data in stored event
        assert "050.423.674-11" not in stored_json
        assert "diego@atenna.ai" not in stored_json
        assert "sk-ant-xyz" not in stored_json
        assert "CPF: 050" not in stored_json

        # Verify only hash and metadata are stored
        assert stored_event.payload_hash is not None
        assert stored_event.entity_types == ["BR_CPF", "EMAIL", "API_KEY"]
        assert stored_event.entity_count == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
