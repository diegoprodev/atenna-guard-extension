"""
Centralized error reporting service.
- Logs all errors to admin_error_events (Supabase)
- Notifies admin via webhook (configurable: Slack/Discord/n8n/email)
- Every error user sees → synced to admin panel
"""
from __future__ import annotations

import asyncio
import os
import traceback
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ADMIN_WEBHOOK_URL = os.getenv("ADMIN_ALERT_WEBHOOK_URL", "")  # Slack/Discord/n8n webhook


def _svc_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


async def log_error(
    *,
    endpoint: str,
    method: str = "POST",
    status_code: int = 500,
    error_type: str,
    error_message: str,
    severity: str = "error",  # debug | info | warning | error | critical
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    context: Optional[dict] = None,
    correlation_id: Optional[str] = None,
) -> str:
    """Log error to admin_error_events. Returns correlation_id for user-facing display."""
    cid = correlation_id or str(uuid.uuid4())[:8].upper()

    payload = {
        "endpoint": endpoint,
        "method": method,
        "status_code": status_code,
        "error_type": error_type,
        "error_message": error_message[:500],
        "severity": severity,
        "correlation_id": cid,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if context:
        payload["context"] = context  # stored if column exists, ignored otherwise

    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            await c.post(
                f"{SUPABASE_URL}/rest/v1/admin_error_events",
                headers=_svc_headers(),
                json=payload,
            )
    except Exception:
        pass  # Never let error logging crash the main flow

    # Notify admin via webhook if configured
    if ADMIN_WEBHOOK_URL and severity in ("error", "critical"):
        asyncio.create_task(_notify_webhook(cid, error_type, error_message, endpoint, user_email))

    return cid


async def log_user_report(
    *,
    user_id: Optional[str],
    user_email: Optional[str],
    error_code: str,
    error_message: str,
    context: Optional[dict] = None,
    page_url: Optional[str] = None,
    extension_version: Optional[str] = None,
) -> str:
    """Log a user-submitted problem report. Returns correlation_id."""
    cid = str(uuid.uuid4())[:8].upper()

    ctx = {
        "page_url": page_url,
        "extension_version": extension_version,
        "user_report": True,
        **(context or {}),
    }

    # Store in admin_error_events with error_type = 'user_report'
    payload = {
        "endpoint": "/user/report-problem",
        "method": "POST",
        "status_code": 0,
        "error_type": "user_report",
        "error_message": f"[USER REPORT] {error_message[:400]}",
        "severity": "warning",
        "correlation_id": cid,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            await c.post(
                f"{SUPABASE_URL}/rest/v1/admin_error_events",
                headers=_svc_headers(),
                json=payload,
            )
    except Exception:
        pass

    # Always notify admin of user reports
    if ADMIN_WEBHOOK_URL:
        asyncio.create_task(_notify_webhook(
            cid, "user_report",
            f"{error_message} | user={user_email} | ctx={ctx}",
            "/user/report",
            user_email,
        ))

    return cid


async def _notify_webhook(
    cid: str,
    error_type: str,
    message: str,
    endpoint: str,
    user_email: Optional[str],
) -> None:
    try:
        body = {
            "text": f"🚨 *Atenna Error [{cid}]*\nType: `{error_type}`\nEndpoint: `{endpoint}`\nUser: {user_email or 'anon'}\nMsg: {message[:300]}",
            "correlation_id": cid,
            "error_type": error_type,
            "endpoint": endpoint,
            "user_email": user_email,
            "message": message[:300],
        }
        async with httpx.AsyncClient(timeout=5.0) as c:
            await c.post(ADMIN_WEBHOOK_URL, json=body)
    except Exception:
        pass
