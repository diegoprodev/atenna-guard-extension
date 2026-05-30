"""
Admin Security Dashboard — /admin/security/*

Endpoints protegidos por require_auth + ADMIN_EMAILS gate.
Expõe os dados do SecurityMonitor para o administrador.
"""
from __future__ import annotations

import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from middleware.auth import require_auth
from security.monitor import get_recent_events, get_security_summary

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/security", tags=["Admin Security"])


def _require_admin(user: dict) -> dict:
    """Verifica que o usuário é admin. Loga tentativas negadas."""
    admin_emails = {e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
    email = user.get("email", "")
    if email not in admin_emails:
        logger.warning(f"[SEC:CRITICAL] admin_access_denied user={email} endpoint=/admin/security")
        # Import inline to avoid circular import
        from security.monitor import log_security_event
        log_security_event("admin_access_denied", {"endpoint": "/admin/security"}, user_id=email, severity="CRITICAL")
        raise HTTPException(403, "Acesso restrito.")
    log_security_event_if_not_flooded(email)
    return user


def log_security_event_if_not_flooded(email: str) -> None:
    try:
        from security.monitor import log_security_event
        log_security_event("admin_access_granted", {"endpoint": "/admin/security"}, user_id=email, severity="CRITICAL")
    except Exception:
        pass


@router.get("/events")
async def list_security_events(
    limit: int = Query(default=100, le=500),
    severity: str | None = Query(default=None, description="CRITICAL|HIGH|MEDIUM|LOW|INFO"),
    _user: dict = Depends(require_auth),
):
    """
    Retorna os últimos N eventos de segurança (ring buffer in-memory).
    Para histórico completo, ler /app/data/security_events.jsonl no servidor.
    """
    _require_admin(_user)
    events = get_recent_events(limit=limit, severity_filter=severity)
    return {"count": len(events), "events": events}


@router.get("/summary")
async def security_summary(_user: dict = Depends(require_auth)):
    """Contagem agregada por severidade e tipo de evento."""
    _require_admin(_user)
    return get_security_summary()


@router.get("/health")
async def security_health(_user: dict = Depends(require_auth)):
    """Verifica se o SecurityMonitor está operacional."""
    _require_admin(_user)
    from security.monitor import SECURITY_LOG_PATH, _event_ring, ALERT_COOLDOWN
    return {
        "status": "ok",
        "log_path": str(SECURITY_LOG_PATH),
        "log_exists": SECURITY_LOG_PATH.exists(),
        "events_in_ring": len(_event_ring),
        "active_cooldowns": len(ALERT_COOLDOWN),
        "admin_email_configured": bool(os.getenv("ADMIN_EMAILS")),
        "resend_configured": bool(os.getenv("RESEND_API_KEY")),
    }
