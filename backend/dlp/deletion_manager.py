"""
FASE 3.1A: Account Deletion Governance

Gerencia ciclo de vida seguro de exclusão de conta conforme LGPD.
Soft delete com grace period, email confirmation, e anonimização.

Lifecycle:
ACTIVE → PENDING_DELETION → DELETION_SCHEDULED → PURGED → ANONYMIZED
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Any
from enum import Enum

from supabase import create_client, Client
import hashlib

logger = logging.getLogger(__name__)


class DeletionStatus(str, Enum):
    """Account deletion lifecycle statuses."""

    PENDING_CONFIRMATION = "pending_confirmation"
    CONFIRMED = "confirmed"
    DELETION_SCHEDULED = "deletion_scheduled"
    PURGING = "purging"
    PURGED = "purged"
    ANONYMIZED = "anonymized"
    CANCELLED = "cancelled"


class DeletionManager:
    """Manages safe account deletion with LGPD compliance."""

    # Grace period: 7 days before actual purge
    DEFAULT_GRACE_PERIOD_DAYS = 7
    # Token validity: 24 hours
    TOKEN_VALIDITY_HOURS = 24
    # Max concurrent deletion requests per user
    MAX_DELETION_REQUESTS = 1

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
    ):
        """Initialize deletion manager with Supabase client."""
        self.supabase: Optional[Client] = None
        self.fallback_mode = False

        if not supabase_url:
            supabase_url = os.getenv("SUPABASE_URL")
        if not supabase_key:
            supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            if not supabase_key:
                supabase_key = os.getenv("SUPABASE_ANON_KEY")

        if supabase_url and supabase_key:
            try:
                self.supabase = create_client(supabase_url, supabase_key)
                logger.info("Deletion manager initialized with Supabase")
            except Exception as e:
                logger.warning(f"Failed to initialize Supabase: {e}")
                self.fallback_mode = True
        else:
            logger.warning("Supabase credentials not configured")
            self.fallback_mode = True

    def initiate_deletion(
        self,
        user_id: str,
        email: str,
        reason: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Initiate account deletion request.

        User receives email with confirmation link.
        Account remains active until confirmation.

        Args:
            user_id: UUID of user requesting deletion
            email: User's email for confirmation
            reason: Optional feedback reason

        Returns:
            {
                "success": bool,
                "confirmation_token": str (hashed),
                "expires_at": datetime,
                "message": str
            }
        """
        if self.fallback_mode or not self.supabase:
            logger.warning("Fallback mode: cannot initiate deletion")
            return {
                "success": False,
                "error": "Supabase not available",
            }

        try:
            # Generate secure confirmation token
            token = secrets.token_urlsafe(32)

            # Call PostgreSQL function
            result = self.supabase.rpc(
                "initiate_account_deletion",
                {
                    "p_user_id": user_id,
                    "p_email": email,
                    "p_reason": reason,
                },
            ).execute()

            if result.data:
                deletion_data = result.data
                logger.info(f"Deletion initiated for user {user_id}")

                return {
                    "success": True,
                    "confirmation_token": deletion_data.get("confirmation_token"),
                    "expires_at": deletion_data.get("expires_at"),
                    "message": deletion_data.get("message"),
                }
            else:
                raise Exception("RPC returned no data")

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Failed to initiate deletion: {error_msg}")

            return {
                "success": False,
                "error": error_msg,
            }

    def confirm_deletion(
        self,
        confirmation_token: str,
        grace_period_days: int = DEFAULT_GRACE_PERIOD_DAYS,
    ) -> dict[str, Any]:
        """
        Confirm account deletion via email link.

        Account transitions to DELETION_SCHEDULED.
        Grace period starts (default 7 days).
        Login remains active during grace period for reversibility.

        Args:
            confirmation_token: Token from email link
            grace_period_days: Days before purge (default 7)

        Returns:
            {
                "success": bool,
                "user_id": str,
                "deletion_scheduled_at": datetime,
                "grace_period_days": int,
                "message": str
            }
        """
        if self.fallback_mode or not self.supabase:
            logger.warning("Fallback mode: cannot confirm deletion")
            return {"success": False, "error": "Supabase not available"}

        try:
            result = self.supabase.rpc(
                "confirm_account_deletion",
                {
                    "p_confirmation_token": confirmation_token,
                    "p_grace_period_days": grace_period_days,
                },
            ).execute()

            if result.data and result.data.get("success"):
                deletion_data = result.data
                logger.info(
                    f"Deletion confirmed for user {deletion_data.get('user_id')}"
                )

                return {
                    "success": True,
                    "user_id": deletion_data.get("user_id"),
                    "deletion_scheduled_at": deletion_data.get("deletion_scheduled_at"),
                    "grace_period_days": grace_period_days,
                    "message": deletion_data.get("message"),
                }
            else:
                return {
                    "success": False,
                    "error": result.data.get("error", "Unknown error"),
                }

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Failed to confirm deletion: {error_msg}")

            return {"success": False, "error": error_msg}

    def cancel_deletion(
        self,
        user_id: str,
        reason: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Cancel pending account deletion.

        Only possible before grace period ends.
        Account returns to ACTIVE status.

        Args:
            user_id: UUID of user
            reason: Optional reason for cancellation

        Returns:
            {
                "success": bool,
                "message": str
            }
        """
        if self.fallback_mode or not self.supabase:
            return {"success": False, "error": "Supabase not available"}

        try:
            result = self.supabase.rpc(
                "cancel_account_deletion",
                {
                    "p_user_id": user_id,
                    "p_reason": reason,
                },
            ).execute()

            if result.data and result.data.get("success"):
                logger.info(f"Deletion cancelled for user {user_id}")
                return {
                    "success": True,
                    "message": result.data.get("message"),
                }
            else:
                return {
                    "success": False,
                    "error": result.data.get("error", "Unknown error"),
                }

        except Exception as e:
            logger.error(f"Failed to cancel deletion: {e}")
            return {"success": False, "error": str(e)}

    def execute_purge(
        self,
        user_id: str,
    ) -> dict[str, Any]:
        """
        Execute account purge (data deletion + anonymization).

        Called after grace period expires.
        Batch-safe operation with retry capability.

        Args:
            user_id: UUID of user

        Returns:
            {
                "success": bool,
                "purge_completed_at": datetime,
                "records_deleted": int,
                "duration_ms": int,
                "message": str
            }
        """
        if self.fallback_mode or not self.supabase:
            return {"success": False, "error": "Supabase not available"}

        try:
            result = self.supabase.rpc(
                "execute_account_purge",
                {"p_user_id": user_id},
            ).execute()

            if result.data and result.data.get("success"):
                purge_data = result.data
                logger.info(
                    f"Purge completed for user {user_id}: "
                    f"{purge_data.get('records_deleted')} records deleted"
                )

                return {
                    "success": True,
                    "purge_completed_at": purge_data.get("purge_completed_at"),
                    "records_deleted": purge_data.get("records_deleted"),
                    "duration_ms": purge_data.get("duration_ms"),
                    "message": purge_data.get("message"),
                }
            else:
                return {
                    "success": False,
                    "error": result.data.get("error", "Unknown error"),
                }

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Purge failed for user {user_id}: {error_msg}")

            return {
                "success": False,
                "error": error_msg,
                "will_retry": True,
            }

    def get_deletion_status(
        self,
        user_id: str,
    ) -> dict[str, Any]:
        """
        Get current deletion request status for user.

        Returns:
            {
                "has_pending_request": bool,
                "status": str,
                "deletion_scheduled_at": datetime | None,
                "grace_period_remaining_days": int | None
            }
        """
        if self.fallback_mode or not self.supabase:
            return {"has_pending_request": False}

        try:
            response = (
                self.supabase.table("user_deletion_requests")
                .select("*")
                .eq("user_id", user_id)
                .in_("status", [
                    DeletionStatus.PENDING_CONFIRMATION,
                    DeletionStatus.DELETION_SCHEDULED,
                ])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )

            if response.data and len(response.data) > 0:
                request = response.data[0]
                scheduled_at = datetime.fromisoformat(
                    request["deletion_scheduled_at"]
                ) if request.get("deletion_scheduled_at") else None

                grace_days = None
                if scheduled_at:
                    delta = scheduled_at - datetime.now(timezone.utc)
                    grace_days = max(0, delta.days)

                return {
                    "has_pending_request": True,
                    "status": request["status"],
                    "deletion_scheduled_at": scheduled_at,
                    "grace_period_remaining_days": grace_days,
                }
            else:
                return {"has_pending_request": False}

        except Exception as e:
            logger.error(f"Failed to get deletion status: {e}")
            return {"has_pending_request": False, "error": str(e)}

    def get_anonymization_summary(self) -> dict[str, Any]:
        """
        Get summary of anonymization operations.

        Returns:
            {
                "total_anonymizations": int,
                "recent_anonymizations": list
            }
        """
        if self.fallback_mode or not self.supabase:
            return {"total_anonymizations": 0}

        try:
            response = (
                self.supabase.table("anonymization_log")
                .select("*")
                .order("created_at", desc=True)
                .limit(100)
                .execute()
            )

            if response.data:
                return {
                    "total_anonymizations": len(response.data),
                    "recent_anonymizations": response.data,
                }
            else:
                return {"total_anonymizations": 0}

        except Exception as e:
            logger.error(f"Failed to get anonymization summary: {e}")
            return {"total_anonymizations": 0, "error": str(e)}


# Global instance
_deletion_manager: Optional[DeletionManager] = None


def get_deletion_manager() -> DeletionManager:
    """Get or create global deletion manager instance."""
    global _deletion_manager
    if _deletion_manager is None:
        _deletion_manager = DeletionManager()
    return _deletion_manager
