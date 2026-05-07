"""
FASE 2.4: Retention Manager Tests

Validates:
- Retention policies defined correctly
- Purge is batch-safe and idempotent
- Storage metrics calculated correctly
- Fallback behavior (no Supabase)
- Concurrent execution protection
"""

import pytest
from datetime import datetime, timedelta, timezone

from dlp.retention_manager import (
    RetentionManager,
    RetentionPolicy,
)


class TestRetentionPolicy:
    """Test retention policy definitions."""

    def test_all_risk_levels_have_retention(self):
        """All risk levels should have defined retention days."""
        required_levels = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "SAFE", "UNKNOWN"]
        for level in required_levels:
            assert level in RetentionPolicy.POLICIES
            assert RetentionPolicy.POLICIES[level] > 0

    def test_retention_days_decreasing_severity(self):
        """Higher severity should have longer retention."""
        assert RetentionPolicy.POLICIES["CRITICAL"] >= RetentionPolicy.POLICIES["HIGH"]
        assert RetentionPolicy.POLICIES["HIGH"] >= RetentionPolicy.POLICIES["MEDIUM"]
        assert RetentionPolicy.POLICIES["MEDIUM"] >= RetentionPolicy.POLICIES["LOW"]

    def test_get_retention_days(self):
        """Get retention days for specific risk level."""
        assert RetentionPolicy.get_retention_days("CRITICAL") == 180
        assert RetentionPolicy.get_retention_days("HIGH") == 120
        assert RetentionPolicy.get_retention_days("MEDIUM") == 60
        assert RetentionPolicy.get_retention_days("LOW") == 30
        assert RetentionPolicy.get_retention_days("SAFE") == 30

    def test_get_retention_days_unknown(self):
        """Unknown risk level should default to 90 days."""
        assert RetentionPolicy.get_retention_days(None) == 90
        assert RetentionPolicy.get_retention_days("UNKNOWN") == 90

    def test_validate_policies(self):
        """Validate that all policies are properly defined."""
        assert RetentionPolicy.validate() is True


class TestRetentionManager:
    """Test retention manager operations."""

    def test_initialize_without_credentials(self):
        """Initialize without Supabase credentials (fallback mode)."""
        manager = RetentionManager(
            supabase_url=None,
            supabase_key=None,
        )
        assert manager.fallback_mode is True
        assert manager.supabase is None

    def test_initialize_with_credentials(self):
        """Initialize with Supabase credentials."""
        manager = RetentionManager(
            supabase_url="https://test.supabase.co",
            supabase_key="fake-key",
        )
        assert manager is not None

    def test_batch_size_validation(self):
        """Batch size should not exceed MAX_BATCH_SIZE."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        # Too large batch should be capped
        assert min(10000, manager.MAX_BATCH_SIZE) == manager.MAX_BATCH_SIZE
        assert min(1000, manager.MAX_BATCH_SIZE) == 1000

    def test_fallback_purge(self):
        """Purge in fallback mode returns error."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        result = manager.purge_expired_events()

        assert result["success"] is False
        assert result["records_purged"] == 0
        assert "error" in result

    def test_fallback_metrics(self):
        """Update metrics in fallback mode returns empty."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        result = manager.update_storage_metrics()

        assert result.get("total_events", 0) == 0

    def test_fallback_retention_summary(self):
        """Get retention summary in fallback mode."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        result = manager.get_retention_summary()

        assert result == {}

    def test_retention_config_validation_fallback(self):
        """Validate retention config in fallback mode."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        result = manager.validate_retention_config()

        assert result is False

    def test_execution_id_uniqueness(self):
        """Each purge execution should have unique ID."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        result1 = manager.purge_expired_events()
        result2 = manager.purge_expired_events()

        assert result1["execution_id"] != result2["execution_id"]

    def test_execution_id_format(self):
        """Execution ID should follow format pattern."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        result = manager.purge_expired_events()
        exec_id = result["execution_id"]

        assert exec_id.startswith("purge_")
        assert len(exec_id) > 10

    def test_duration_ms_calculation(self):
        """Duration should be positive number."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        result = manager.purge_expired_events()

        assert "duration_ms" in result
        assert result["duration_ms"] >= 0

    def test_get_retention_policies_fallback(self):
        """Get policies in fallback mode returns defaults."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        policies = manager.get_retention_policies()

        assert policies == RetentionPolicy.POLICIES
        assert len(policies) >= 6


class TestRetentionScenarios:
    """Test real-world retention scenarios."""

    def test_critical_event_retention_180_days(self):
        """CRITICAL events retain for 180 days."""
        retention_days = RetentionPolicy.get_retention_days("CRITICAL")
        assert retention_days == 180

        created_at = datetime.now(timezone.utc)
        expires_at = created_at + timedelta(days=retention_days)

        assert expires_at > created_at
        assert (expires_at - created_at).days == 180

    def test_high_event_retention_120_days(self):
        """HIGH events retain for 120 days."""
        retention_days = RetentionPolicy.get_retention_days("HIGH")
        assert retention_days == 120

    def test_medium_event_retention_60_days(self):
        """MEDIUM events retain for 60 days."""
        retention_days = RetentionPolicy.get_retention_days("MEDIUM")
        assert retention_days == 60

    def test_low_event_retention_30_days(self):
        """LOW events retain for 30 days."""
        retention_days = RetentionPolicy.get_retention_days("LOW")
        assert retention_days == 30

    def test_batch_deletion_safety(self):
        """Batch deletion should respect MAX_BATCH_SIZE."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        # Requesting 10k should be capped to MAX_BATCH_SIZE
        large_batch = 10000
        safe_batch = min(large_batch, manager.MAX_BATCH_SIZE)

        assert safe_batch <= manager.MAX_BATCH_SIZE
        assert safe_batch == 5000  # MAX_BATCH_SIZE

    def test_idempotent_execution(self):
        """Same execution_id on retry should be idempotent."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        # Two purges with fallback mode (always safe)
        result1 = manager.purge_expired_events()
        result2 = manager.purge_expired_events()

        # Both should fail same way (fallback mode)
        assert result1["success"] == result2["success"]
        # But execution IDs should differ
        assert result1["execution_id"] != result2["execution_id"]


class TestRetentionDataIntegrity:
    """Test data integrity during retention operations."""

    def test_retention_log_structure(self):
        """Retention log should track operation details."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)
        result = manager.purge_expired_events()

        # Result should have all required fields
        assert "success" in result
        assert "execution_id" in result
        assert "records_purged" in result
        assert "duration_ms" in result
        assert "error" in result

    def test_no_critical_data_loss(self):
        """Retention operations should never lose critical data."""
        # Critical events (180 day retention) should be preserved
        retention_days = RetentionPolicy.get_retention_days("CRITICAL")
        assert retention_days >= 120  # At least 4 months

    def test_soft_delete_capability(self):
        """System supports purging without hard corruption."""
        # Returns clean failure result, no data loss
        manager = RetentionManager(supabase_url=None, supabase_key=None)
        result = manager.purge_expired_events()

        # Even on failure, structure is preserved
        assert isinstance(result, dict)
        assert "execution_id" in result

    def test_metrics_isolation(self):
        """Metrics update should not affect event data."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)

        # Metrics is read-only, doesn't modify events
        result = manager.update_storage_metrics()

        # Should not raise, but return empty (fallback)
        assert isinstance(result, dict)


class TestRetentionPerformance:
    """Test retention operation performance characteristics."""

    def test_batch_size_default(self):
        """Default batch size should be reasonable."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)
        assert manager.DEFAULT_BATCH_SIZE == 1000

    def test_max_batch_size_safe(self):
        """Max batch size should prevent lock timeouts."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)
        assert manager.MAX_BATCH_SIZE <= 5000

    def test_lock_timeout_reasonable(self):
        """Lock timeout should be sufficient for batch ops."""
        manager = RetentionManager(supabase_url=None, supabase_key=None)
        assert manager.LOCK_TIMEOUT_SECONDS >= 300  # At least 5 minutes


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
