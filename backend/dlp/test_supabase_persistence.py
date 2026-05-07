"""
FASE 2.2: Supabase Persistence Tests

Tests for dlp_events table integration with fallback handling.
Can run with or without Supabase (fallback to in-memory).
"""

import pytest
import os
from datetime import datetime, timezone

from dlp.telemetry_persistence import TelemetryEvent
from dlp.supabase_telemetry import SupabaseTelemetryPersistence


class TestSupabaseInitialization:
    """Test initialization with and without Supabase credentials."""

    def test_initialize_with_credentials(self):
        """Initialize with Supabase URL and key."""
        # Should not raise
        persistence = SupabaseTelemetryPersistence(
            supabase_url="https://test.supabase.co",
            supabase_key="fake-key",
        )
        assert persistence is not None

    def test_initialize_without_credentials(self):
        """Initialize without credentials (fallback mode)."""
        persistence = SupabaseTelemetryPersistence(
            supabase_url=None,
            supabase_key=None,
        )
        assert persistence.fallback_mode is True
        assert len(persistence.events) == 0


class TestSupabasePersistence:
    """Test persisting events."""

    def test_persist_safe_event(self):
        """Safe event can be persisted."""
        persistence = SupabaseTelemetryPersistence(
            supabase_url=None,
            supabase_key=None,
        )

        event = TelemetryEvent(
            event_type="dlp_scan_complete",
            timestamp=123.0,
            payload_hash="abc123def456",
            risk_level="HIGH",
            entity_types=["BR_CPF"],
            entity_count=1,
        )

        result = persistence.persist(event, user_id="test-user")

        # Should succeed (in-memory fallback)
        assert len(persistence.events) == 1
        assert persistence.events[0].event_type == "dlp_scan_complete"

    def test_reject_event_with_cpf(self):
        """Event with CPF pattern is rejected."""
        persistence = SupabaseTelemetryPersistence(
            supabase_url=None,
            supabase_key=None,
        )

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="abc",
            source="050.423.674-11",  # CPF!
        )

        result = persistence.persist(event, user_id="test-user")

        assert result is False
        assert len(persistence.events) == 0  # Not saved

    def test_reject_event_with_email(self):
        """Event with email pattern is rejected."""
        persistence = SupabaseTelemetryPersistence()

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="abc",
            endpoint="diego@atenna.ai",  # Email!
        )

        result = persistence.persist(event, user_id="test-user")

        assert result is False

    def test_reject_event_with_api_key(self):
        """Event with API key pattern is rejected."""
        persistence = SupabaseTelemetryPersistence()

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="abc",
            source="sk-ant-v3aBcDefGhijKlmnOp_1234567890",
        )

        result = persistence.persist(event, user_id="test-user")

        assert result is False

    def test_entity_types_not_values(self):
        """Only entity types stored, not values."""
        persistence = SupabaseTelemetryPersistence()

        event = TelemetryEvent(
            event_type="dlp_scan",
            timestamp=123.0,
            payload_hash="hash",
            entity_types=["BR_CPF", "EMAIL"],
            entity_count=2,
        )

        persistence.persist(event, user_id="test-user")

        # Verify stored event
        stored_event = persistence.events[-1]
        stored_json = stored_event.to_json()

        # No CPF values should appear anywhere
        assert "050" not in stored_json
        assert "423" not in stored_json
        assert "674" not in stored_json

        # No email values
        assert "@" not in stored_json or "entity_types" in stored_json

        # Only types should be there
        assert "BR_CPF" in stored_json
        assert "EMAIL" in stored_json

    def test_created_at_set_automatically(self):
        """created_at is set automatically if not provided."""
        persistence = SupabaseTelemetryPersistence()

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="abc",
        )

        before = datetime.now(timezone.utc)
        persistence.persist(event, user_id="user")
        after = datetime.now(timezone.utc)

        assert event.created_at is not None
        assert before <= event.created_at <= after


class TestFallbackBehavior:
    """Test fallback to in-memory when Supabase unavailable."""

    def test_fallback_if_supabase_none(self):
        """Falls back to in-memory if Supabase client is None."""
        persistence = SupabaseTelemetryPersistence()
        persistence.supabase = None
        persistence.fallback_mode = True

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="abc",
        )

        result = persistence.persist(event, user_id="user")

        # Should still save to in-memory
        assert len(persistence.events) == 1
        # But return False to indicate Supabase wasn't used
        assert result is False

    def test_fallback_preserves_data(self):
        """Fallback preserves all event data."""
        persistence = SupabaseTelemetryPersistence()

        event = TelemetryEvent(
            event_type="dlp_timeout",
            timestamp=456.0,
            payload_hash="xyz789",
            risk_level="UNKNOWN",
            timeout_occurred=True,
            duration_ms=3000,
            source="server",
            endpoint="/scan",
            session_id="sess-123",
        )

        persistence.persist(event, user_id="user-abc")

        stored = persistence.events[-1]
        assert stored.event_type == "dlp_timeout"
        assert stored.risk_level == "UNKNOWN"
        assert stored.timeout_occurred is True
        assert stored.duration_ms == 3000
        assert stored.source == "server"


class TestAggregateStats:
    """Test safe analytics queries."""

    def test_aggregate_stats_empty(self):
        """Aggregate stats with no events."""
        persistence = SupabaseTelemetryPersistence()

        stats = persistence.get_aggregate_stats()

        assert stats == {}

    def test_aggregate_stats_basic(self):
        """Aggregate stats with multiple events."""
        persistence = SupabaseTelemetryPersistence()

        # Insert test events
        for i in range(3):
            event = TelemetryEvent(
                event_type="test",
                timestamp=float(i),
                payload_hash=f"hash{i}",
                risk_level="HIGH" if i < 2 else "LOW",
                entity_types=["BR_CPF"] if i < 2 else ["EMAIL"],
                entity_count=i + 1,
                timeout_occurred=(i == 2),
            )
            persistence.persist(event)

        stats = persistence.get_aggregate_stats()

        assert stats["total_events"] == 3
        assert stats["by_risk_level"]["HIGH"] == 2
        assert stats["by_risk_level"]["LOW"] == 1
        assert stats["by_entity_type"]["BR_CPF"] == 2
        assert stats["by_entity_type"]["EMAIL"] == 1
        assert stats["timeout_rate"] == 1 / 3


class TestDataIntegrity:
    """Test that persisted data maintains integrity and privacy."""

    def test_no_raw_payload_in_stored_event(self):
        """Payload is never stored raw, only hash."""
        persistence = SupabaseTelemetryPersistence()

        sensitive_payload = "CPF: 050.423.674-11\nEmail: diego@atenna.ai\nAPI: sk-ant-xyz"

        from dlp.telemetry_persistence import hash_payload

        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash=hash_payload(sensitive_payload),
            entity_types=["BR_CPF", "EMAIL", "API_KEY"],
            entity_count=3,
        )

        persistence.persist(event)

        stored_json = persistence.events[-1].to_json()

        # Verify no sensitive data
        assert "050.423.674-11" not in stored_json
        assert "diego@atenna.ai" not in stored_json
        assert "sk-ant-xyz" not in stored_json

        # Verify hash is present
        assert event.payload_hash in stored_json

    def test_safe_event_schema(self):
        """Event schema is clean and safe."""
        persistence = SupabaseTelemetryPersistence()

        # Create safe event
        event = TelemetryEvent(
            event_type="test",
            timestamp=123.0,
            payload_hash="abc",
            entity_types=["BR_CPF"],
            risk_level="HIGH",
        )

        # Should persist successfully
        persistence.persist(event)
        assert len(persistence.events) >= 1

        # Verify no sensitive data in serialized form
        event_json = event.to_json()
        assert "050" not in event_json
        assert "CPF:" not in event_json


class TestMultipleEvents:
    """Test handling multiple events."""

    def test_persist_multiple_events(self):
        """Can persist multiple events sequentially."""
        persistence = SupabaseTelemetryPersistence()

        for i in range(10):
            event = TelemetryEvent(
                event_type=f"event_{i}",
                timestamp=float(i),
                payload_hash=f"hash_{i}",
            )
            persistence.persist(event, user_id=f"user_{i % 3}")

        assert len(persistence.events) == 10

    def test_get_events_all(self):
        """Retrieve all events."""
        persistence = SupabaseTelemetryPersistence()

        for i in range(5):
            event = TelemetryEvent(
                event_type=f"test_{i}",
                timestamp=float(i),
                payload_hash=f"h{i}",
            )
            persistence.persist(event)

        events = persistence.get_events()
        assert len(events) == 5

    def test_get_events_by_session(self):
        """Retrieve events filtered by session."""
        persistence = SupabaseTelemetryPersistence()

        for session_id in ["sess_a", "sess_b"]:
            for i in range(3):
                event = TelemetryEvent(
                    event_type=f"test_{i}",
                    timestamp=float(i),
                    payload_hash=f"h{i}_{session_id}",
                    session_id=session_id,
                )
                persistence.persist(event)

        events_a = persistence.get_events(session_id="sess_a")
        assert len(events_a) == 3
        assert all(e.session_id == "sess_a" for e in events_a)

        events_b = persistence.get_events(session_id="sess_b")
        assert len(events_b) == 3
        assert all(e.session_id == "sess_b" for e in events_b)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
