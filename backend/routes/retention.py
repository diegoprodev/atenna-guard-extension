"""
FASE 2.4: Retention Management API

Endpoints for managing DLP event retention, purging, and metrics.
- Trigger purge jobs
- View retention policies
- Get storage metrics
- Monitor retention summary
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
import logging

from middleware.auth import require_auth
from dlp.retention_manager import get_retention_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/retention", tags=["Retention Management"])


@router.get("/health", tags=["Retention"])
async def retention_health():
    """Check retention manager health and configuration."""
    manager = get_retention_manager()
    is_valid = manager.validate_retention_config()

    return {
        "status": "ok" if is_valid else "degraded",
        "fallback_mode": manager.fallback_mode,
        "configured": not manager.fallback_mode,
    }


@router.get("/policies", tags=["Retention"])
async def get_retention_policies(_user: dict = Depends(require_auth)):
    """
    Get current retention policies by risk level.

    Returns:
        {
            "CRITICAL": 180,
            "HIGH": 120,
            "MEDIUM": 60,
            "LOW": 30,
            "SAFE": 30,
            "UNKNOWN": 90
        }
    """
    manager = get_retention_manager()
    policies = manager.get_retention_policies()

    if not policies:
        raise HTTPException(status_code=503, detail="Retention policies unavailable")

    return policies


@router.get("/summary", tags=["Retention"])
async def get_retention_summary(_user: dict = Depends(require_auth)):
    """
    Get summary of events expiring soon.

    Returns:
        {
            "expiring_today": int,
            "expiring_7_days": int,
            "expiring_30_days": int,
            "by_risk_level": {
                "CRITICAL": int,
                "HIGH": int,
                ...
            }
        }
    """
    manager = get_retention_manager()
    summary = manager.get_retention_summary()

    if not summary:
        logger.warning("No retention summary available (fallback mode)")
        return {
            "expiring_today": 0,
            "expiring_7_days": 0,
            "expiring_30_days": 0,
            "by_risk_level": {},
        }

    return summary


@router.get("/metrics", tags=["Retention"])
async def get_storage_metrics(_user: dict = Depends(require_auth)):
    """
    Get storage and retention metrics.

    Returns:
        {
            "total_events": int,
            "by_risk_level": {
                "CRITICAL": int,
                "HIGH": int,
                ...
            },
            "avg_retention_days": float,
            "growth_rate_pct": float,
            "estimated_storage_mb": float
        }
    """
    manager = get_retention_manager()
    metrics = manager.update_storage_metrics()

    if not metrics:
        logger.warning("No metrics available (fallback mode)")
        return {
            "total_events": 0,
            "by_risk_level": {},
            "avg_retention_days": 0,
            "growth_rate_pct": 0,
            "estimated_storage_mb": 0,
        }

    return metrics


@router.post("/purge", tags=["Retention"])
async def trigger_purge(
    batch_size: Optional[int] = Query(default=1000, ge=100, le=5000),
    _user: dict = Depends(require_auth),
):
    """
    Trigger batch purge of expired events.

    Admin/scheduled operation. Safe batch-based deletion.

    Args:
        batch_size: How many records to delete per batch (100-5000, default 1000)

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
    # In production, validate user has admin/scheduler role
    user_id = _user.get("sub")
    logger.info(f"Purge triggered by {user_id}, batch_size={batch_size}")

    manager = get_retention_manager()
    result = manager.purge_expired_events(batch_size=batch_size)

    if not result["success"]:
        logger.error(f"Purge failed: {result.get('error')}")
        raise HTTPException(
            status_code=503,
            detail=f"Purge failed: {result.get('error')}",
        )

    logger.info(
        f"Purge completed: {result['records_purged']} records, "
        f"duration: {result['duration_ms']}ms"
    )

    return result


@router.post("/validate-config", tags=["Retention"])
async def validate_retention_config(_user: dict = Depends(require_auth)):
    """
    Validate retention configuration is properly set up.

    Returns:
        {
            "valid": bool,
            "fallback_mode": bool,
            "message": str
        }
    """
    manager = get_retention_manager()
    is_valid = manager.validate_retention_config()

    return {
        "valid": is_valid,
        "fallback_mode": manager.fallback_mode,
        "message": "Retention config is valid" if is_valid else "Retention config has issues",
    }
