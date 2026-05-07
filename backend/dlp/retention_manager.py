"""
FASE 2.4: Retention & Operational Governance

Manages lifecycle of DLP telemetry events based on retention policies.
- Automatic expiration based on risk level
- Batch-safe deletion (prevents large locks)
- Idempotent execution (safe for cron retry)
- Operational metrics (growth, storage estimate)
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Any

from supabase import create_client, Client

logger = logging.getLogger(__name__)


class RetentionPolicy:
    """Retention policy by risk level."""

    POLICIES = {
        "CRITICAL": 180,  # 6 months
        "HIGH": 120,      # 4 months
        "MEDIUM": 60,     # 2 months
        "LOW": 30,        # 1 month
        "SAFE": 30,       # 1 month
        "UNKNOWN": 90,    # 3 months (operational)
    }

    @classmethod
    def get_retention_days(cls, risk_level: Optional[str]) -> int:
        """Get retention days for a risk level. Default to 90."""
        if not risk_level:
            return 90
        return cls.POLICIES.get(risk_level, 90)

    @classmethod
    def validate(cls) -> bool:
        """Validate all policies are defined."""
        return all(
            cls.POLICIES.get(level)
            for level in ["CRITICAL", "HIGH", "MEDIUM", "LOW", "SAFE", "UNKNOWN"]
        )


class RetentionManager:
    """Manages DLP event retention and expiration."""

    # Safe batch size to avoid locks
    DEFAULT_BATCH_SIZE = 1000
    MAX_BATCH_SIZE = 5000
    LOCK_TIMEOUT_SECONDS = 300

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
    ):
        """Initialize retention manager with Supabase client."""
        self.supabase: Optional[Client] = None
        self.fallback_mode = False

        # Get from environment if not provided
        if not supabase_url:
            supabase_url = os.getenv("SUPABASE_URL")
        if not supabase_key:
            supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            if not supabase_key:
                supabase_key = os.getenv("SUPABASE_ANON_KEY")

        if supabase_url and supabase_key:
            try:
                self.supabase = create_client(supabase_url, supabase_key)
                logger.info("Retention manager initialized with Supabase")
            except Exception as e:
                logger.warning(f"Failed to initialize Supabase: {e}")
                self.fallback_mode = True
        else:
            logger.warning("Supabase credentials not configured")
            self.fallback_mode = True

    def purge_expired_events(
        self,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> dict[str, Any]:
        """
        Purge expired events in safe batches.

        Args:
            batch_size: How many records to delete per batch (max 5000)

        Returns:
            {
                "success": bool,
                "execution_id": str,
                "records_purged": int,
                "duration_ms": int,
                "policies_applied": list[str],
                "error": str | None
            }
        """
        execution_id = f"purge_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"
        start_time = datetime.now(timezone.utc)

        logger.info(f"Starting retention purge: {execution_id}")

        if self.fallback_mode or not self.supabase:
            logger.warning("Fallback mode: skipping purge (no Supabase)")
            return {
                "success": False,
                "execution_id": execution_id,
                "records_purged": 0,
                "duration_ms": 0,
                "error": "Supabase not available",
            }

        try:
            # Call the PostgreSQL function directly
            result = self.supabase.rpc(
                "purge_expired_events",
                {"p_batch_size": min(batch_size, self.MAX_BATCH_SIZE)},
            ).execute()

            if result.data:
                duration_ms = int(
                    (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
                )
                records_purged = result.data.get("records_purged", 0)
                policies = result.data.get("policies_applied", [])

                logger.info(
                    f"Purge completed: {records_purged} records, "
                    f"policies: {policies}, duration: {duration_ms}ms"
                )

                return {
                    "success": True,
                    "execution_id": execution_id,
                    "records_purged": records_purged,
                    "duration_ms": duration_ms,
                    "policies_applied": policies,
                    "error": None,
                }
            else:
                raise Exception("RPC returned no data")

        except Exception as e:
            error_msg = str(e)
            duration_ms = int(
                (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            )

            logger.error(f"Purge failed: {error_msg} (duration: {duration_ms}ms)")

            return {
                "success": False,
                "execution_id": execution_id,
                "records_purged": 0,
                "duration_ms": duration_ms,
                "policies_applied": [],
                "error": error_msg,
            }

    def update_storage_metrics(self) -> dict[str, Any]:
        """
        Update storage and retention metrics.

        Returns:
            {
                "total_events": int,
                "by_risk_level": dict,
                "avg_retention_days": float,
                "growth_rate_pct": float,
                "estimated_storage_mb": float
            }
        """
        if self.fallback_mode or not self.supabase:
            logger.warning("Fallback mode: skipping metrics update")
            return {
                "total_events": 0,
                "by_risk_level": {},
                "avg_retention_days": 0,
                "growth_rate_pct": 0,
                "estimated_storage_mb": 0,
            }

        try:
            result = self.supabase.rpc("update_storage_metrics", {}).execute()

            if result.data:
                metrics = result.data
                logger.info(
                    f"Metrics updated: {metrics['total_events']} events, "
                    f"growth: {metrics['growth_rate_pct']:.2f}%, "
                    f"storage: {metrics['estimated_storage_mb']:.2f}MB"
                )
                return metrics
            else:
                raise Exception("RPC returned no data")

        except Exception as e:
            logger.error(f"Failed to update metrics: {e}")
            return {}

    def get_retention_policies(self) -> dict[str, int]:
        """
        Fetch retention policies from database.

        Returns:
            {
                "CRITICAL": 180,
                "HIGH": 120,
                "MEDIUM": 60,
                ...
            }
        """
        if self.fallback_mode or not self.supabase:
            logger.warning("Fallback mode: using hardcoded policies")
            return RetentionPolicy.POLICIES

        try:
            response = self.supabase.table("dlp_retention_policies").select("*").execute()

            if response.data:
                policies = {}
                for row in response.data:
                    policies[row["risk_level"]] = row["retention_days"]
                return policies
            else:
                logger.warning("No policies found, using defaults")
                return RetentionPolicy.POLICIES

        except Exception as e:
            logger.error(f"Failed to fetch policies: {e}")
            return RetentionPolicy.POLICIES

    def get_retention_summary(self) -> dict[str, Any]:
        """
        Get summary of events expiring soon.

        Returns:
            {
                "expiring_today": int,
                "expiring_7_days": int,
                "expiring_30_days": int,
                "by_risk_level": dict
            }
        """
        if self.fallback_mode or not self.supabase:
            return {}

        try:
            # Query events by expiration window
            today = datetime.now(timezone.utc).date()

            # Today
            response_today = (
                self.supabase.table("dlp_events")
                .select("count", count="exact")
                .lt("expires_at", f"{today}T23:59:59Z")
                .gte("expires_at", f"{today}T00:00:00Z")
                .execute()
            )

            # 7 days
            seven_days_from_now = today + timedelta(days=7)
            response_7 = (
                self.supabase.table("dlp_events")
                .select("count", count="exact")
                .lt("expires_at", f"{seven_days_from_now}T23:59:59Z")
                .gte("expires_at", f"{today}T00:00:00Z")
                .execute()
            )

            # 30 days
            thirty_days_from_now = today + timedelta(days=30)
            response_30 = (
                self.supabase.table("dlp_events")
                .select("count", count="exact")
                .lt("expires_at", f"{thirty_days_from_now}T23:59:59Z")
                .gte("expires_at", f"{today}T00:00:00Z")
                .execute()
            )

            # By risk level
            response_risk = (
                self.supabase.table("dlp_events")
                .select("risk_level, count", count="exact")
                .execute()
            )

            by_risk = {}
            if response_risk.data:
                for row in response_risk.data:
                    by_risk[row.get("risk_level", "UNKNOWN")] = row.get("count", 0)

            return {
                "expiring_today": response_today.count or 0,
                "expiring_7_days": response_7.count or 0,
                "expiring_30_days": response_30.count or 0,
                "by_risk_level": by_risk,
            }

        except Exception as e:
            logger.error(f"Failed to get retention summary: {e}")
            return {}

    def validate_retention_config(self) -> bool:
        """Validate retention policies are properly configured."""
        if not RetentionPolicy.validate():
            logger.error("Retention policies not properly defined")
            return False

        if self.fallback_mode:
            logger.warning("Running in fallback mode (no Supabase)")
            return False

        try:
            policies = self.get_retention_policies()
            if not policies:
                logger.error("No retention policies found in database")
                return False

            logger.info(f"Retention config valid: {len(policies)} policies")
            return True

        except Exception as e:
            logger.error(f"Failed to validate retention config: {e}")
            return False


# Global instance
_retention_manager: Optional[RetentionManager] = None


def get_retention_manager() -> RetentionManager:
    """Get or create global retention manager instance."""
    global _retention_manager
    if _retention_manager is None:
        _retention_manager = RetentionManager()
    return _retention_manager
