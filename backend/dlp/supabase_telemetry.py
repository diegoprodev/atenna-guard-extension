"""
FASE 2.2: Supabase-backed Telemetry Persistence

Persists DLP events to Supabase dlp_events table.
Fallback to in-memory if Supabase unavailable.
Zero PII — safe metrics only.
"""

from __future__ import annotations

import os
import logging
import json
from typing import Optional, Any
from datetime import datetime, timezone
from dataclasses import asdict

from supabase import create_client, Client

from .telemetry_persistence import TelemetryEvent, TelemetryPersistence


class SupabaseTelemetryPersistence(TelemetryPersistence):
    """Supabase-backed persistence with in-memory fallback."""

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
    ):
        """Initialize Supabase client with service role key for insert."""
        super().__init__()  # Keeps in-memory store as fallback

        self.supabase: Optional[Client] = None
        self.fallback_mode = False

        # Get from environment if not provided
        if not supabase_url:
            supabase_url = os.getenv("SUPABASE_URL")

        # Use SERVICE_ROLE_KEY for backend (bypasses RLS)
        if not supabase_key:
            supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            if not supabase_key:
                supabase_key = os.getenv("SUPABASE_ANON_KEY")

        if supabase_url and supabase_key:
            try:
                self.supabase = create_client(supabase_url, supabase_key)
                logging.info("Supabase telemetry persistence initialized")
            except Exception as e:
                logging.warning(f"Failed to initialize Supabase: {e}")
                self.fallback_mode = True
        else:
            logging.warning(
                "Supabase credentials not configured — using in-memory fallback"
            )
            self.fallback_mode = True

    def persist(
        self, event: TelemetryEvent, user_id: Optional[str] = None
    ) -> bool:
        """
        Persist event to Supabase (with in-memory fallback).

        Args:
            event: TelemetryEvent with safe data only
            user_id: User ID for context

        Returns:
            True if persisted to Supabase, False if fallback or validation failed
        """
        # Validate: no sensitive fields
        if self._contains_sensitive_data(event):
            logging.warning("Event rejected: contains sensitive data")
            return False

        # Set timestamp if not provided
        if not event.created_at:
            event.created_at = datetime.now(timezone.utc)

        # Convert to dict for DB
        event_dict = event.to_dict()
        event_dict["user_id"] = user_id

        # Map TelemetryEvent fields to dlp_events table columns
        db_event = {
            "user_id": user_id,
            "event_type": event.event_type,
            "risk_level": event.risk_level,
            "entity_types": event.entity_types or [],
            "entity_count": event.entity_count,
            "was_rewritten": event.was_rewritten,
            "had_mismatch": event.had_mismatch,
            "timeout_occurred": event.timeout_occurred,
            "error_occurred": event.error_occurred,
            "duration_ms": event.duration_ms or 0,
            "score": event.score,
            "provider": event.source,
            "endpoint": event.endpoint,
            "session_id": event.session_id,
            "hashed_payload_id": event.payload_hash,
            "created_at": event.created_at.isoformat() if event.created_at else datetime.now(timezone.utc).isoformat(),
        }

        # Only include non-None values (except empty arrays and 0s which are valid)
        db_event = {k: v for k, v in db_event.items() if v is not None and v != ""}

        # Try Supabase first
        if self.supabase and not self.fallback_mode:
            try:
                response = self.supabase.table("dlp_events").insert(
                    db_event
                ).execute()

                if response.data:
                    logging.debug(f"Event persisted to Supabase: {event.event_type}")
                    return True
                else:
                    raise Exception("Insert returned no data")

            except Exception as e:
                logging.error(f"Supabase persistence failed: {e}")
                self._emit_persistence_failure(user_id, str(e))
                # Fall through to in-memory fallback

        # Fallback: save to in-memory
        self.events.append(event)
        logging.debug(
            f"Event saved to in-memory fallback: {event.event_type} (total: {len(self.events)})"
        )

        return False  # Indicate DB was not used

    def get_safe_aggregates(
        self,
        user_id: str,
        days: int = 30,
    ) -> dict[str, Any]:
        """
        Get safe analytics from Supabase (via aggregation queries).

        Args:
            user_id: User ID to filter
            days: Look back N days

        Returns:
            Safe aggregates (no PII, no individuals)
        """

        if self.supabase and not self.fallback_mode:
            try:
                # 1. Count by risk level
                response = self.supabase.table("dlp_events").select(
                    "risk_level,count(*)",
                ).eq("user_id", user_id).gt(
                    "created_at",
                    datetime.now(timezone.utc)
                    .replace(day=datetime.now(timezone.utc).day - days)
                    .isoformat(),
                ).group_by("risk_level").execute()

                by_risk_level = {}
                if response.data:
                    for row in response.data:
                        by_risk_level[row["risk_level"]] = row["count"]

                return {
                    "total_events": len(by_risk_level),
                    "by_risk_level": by_risk_level,
                    "source": "supabase",
                }

            except Exception as e:
                logging.error(f"Supabase aggregation failed: {e}")
                # Fall through to in-memory fallback

        # Fallback: use in-memory data
        return super().get_aggregate_stats()

    def _emit_persistence_failure(
        self,
        user_id: Optional[str],
        error: str,
    ) -> None:
        """Log that Supabase persistence failed."""
        from . import telemetry

        telemetry._emit("dlp_telemetry_persistence_failed", {
            "user_id": user_id,
            "error": error,
            "fallback": "in_memory",
        })


# Global instance
_persistence: Optional[SupabaseTelemetryPersistence] = None


def get_supabase_persistence() -> SupabaseTelemetryPersistence:
    """Get or create global Supabase persistence instance."""
    global _persistence
    if _persistence is None:
        _persistence = SupabaseTelemetryPersistence()
    return _persistence
