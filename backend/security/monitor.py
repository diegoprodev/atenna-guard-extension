"""
SecurityMonitor — A09 Enterprise SIEM Layer.

Responsabilidades:
  1. Log estruturado de todos os eventos de segurança → security_events.jsonl
  2. Alertas por email (Resend) para eventos críticos
  3. Detecção de burst de falhas de autenticação por IP (circuit breaker)
  4. Endpoint /admin/security/events para dashboard do administrador

Eventos monitorados:
  CRITICAL:  admin_access_denied, admin_access_granted, webhook_auth_failed,
             auth_burst_detected, bff_sessions_fallback_mode
  HIGH:      dlp_strict_applied, dlp_analysis_failed, token_expired_burst
  MEDIUM:    login_rate_limited, auth_failure, checkout_anomaly
  LOW:       plan_upgraded, plan_downgraded, cleanup_ran
"""
from __future__ import annotations

import json
import logging
import os
import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

ADMIN_ALERT_EMAIL = os.getenv("ADMIN_EMAILS", "devdiegopro@gmail.com").split(",")[0].strip()
SECURITY_LOG_PATH = Path(os.getenv("SECURITY_LOG_PATH", "/app/data/security_events.jsonl"))
ALERT_FROM        = "segurança@atenna.app"

# Auth burst: se mesmo IP falhar N vezes em W segundos → alerta
AUTH_BURST_MAX    = int(os.getenv("AUTH_BURST_MAX", "10"))
AUTH_BURST_WINDOW = int(os.getenv("AUTH_BURST_WINDOW", "300"))   # 5 min

# Rate limit nos próprios alertas (evita flood de emails)
ALERT_COOLDOWN: dict[str, float] = {}
ALERT_COOLDOWN_SECS = 300  # 5 min entre alertas do mesmo tipo

# In-memory event ring (últimos 500 eventos) — sem estado persistente em memória
_event_ring: deque[dict] = deque(maxlen=500)

# Auth failure tracking per IP
_auth_failures: dict[str, deque] = {}

# ── Severity levels ───────────────────────────────────────────────────────────

SEVERITY = {
    "admin_access_denied":    "CRITICAL",
    "admin_access_granted":   "CRITICAL",
    "webhook_auth_failed":    "CRITICAL",
    "webhook_token_missing":  "CRITICAL",
    "auth_burst_detected":    "CRITICAL",
    "bff_sessions_fallback":  "CRITICAL",
    "dlp_strict_applied":     "HIGH",
    "dlp_analysis_failed":    "HIGH",
    "token_expired_burst":    "HIGH",
    "login_rate_limited":     "MEDIUM",
    "auth_failure":           "MEDIUM",
    "checkout_anomaly":       "MEDIUM",
    "plan_upgraded":          "LOW",
    "plan_downgraded":        "LOW",
    "cleanup_ran":            "LOW",
}


def _should_alert(event_type: str) -> bool:
    """Rate-limit alerts to avoid email flood."""
    key = f"alert:{event_type}"
    last = ALERT_COOLDOWN.get(key, 0.0)
    if time.monotonic() - last > ALERT_COOLDOWN_SECS:
        ALERT_COOLDOWN[key] = time.monotonic()
        return True
    return False


def _write_log(entry: dict) -> None:
    """Append event to security_events.jsonl (structured, append-only)."""
    try:
        SECURITY_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with SECURITY_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
    except Exception as e:
        logger.error(f"[SecurityMonitor] Failed to write log: {e}")


def log_security_event(
    event_type: str,
    data: dict[str, Any],
    user_id: str = "",
    ip: str = "",
    severity: str = "",
) -> None:
    """
    Core logging function — called by all security-aware code.
    Writes to ring buffer + file. Triggers async alert for CRITICAL/HIGH.
    """
    sev = severity or SEVERITY.get(event_type, "INFO")
    entry = {
        "ts":         datetime.now(timezone.utc).isoformat(),
        "severity":   sev,
        "event":      event_type,
        "user_id":    user_id or "—",
        "ip":         ip or "—",
        **data,
    }

    _event_ring.append(entry)
    _write_log(entry)

    logger.warning(f"[SEC:{sev}] {event_type} user={user_id or '—'} ip={ip or '—'} {json.dumps(data, default=str)[:200]}")

    # Fire-and-forget alert for CRITICAL/HIGH
    if sev in ("CRITICAL", "HIGH") and _should_alert(event_type):
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(_send_security_alert(event_type, sev, entry))
        except RuntimeError:
            pass  # No event loop — skip alert (happens during tests)


async def _send_security_alert(event_type: str, severity: str, entry: dict) -> None:
    """Send email alert via Resend for critical security events."""
    try:
        from routes.email_service import send_email

        ts    = entry.get("ts", "")
        user  = entry.get("user_id", "—")
        ip    = entry.get("ip", "—")
        data  = {k: v for k, v in entry.items() if k not in ("ts", "severity", "event", "user_id", "ip")}

        color_map = {"CRITICAL": "#dc2626", "HIGH": "#d97706"}
        color = color_map.get(severity, "#6b7280")

        html = f"""
<!DOCTYPE html><html><body style="font-family:monospace;background:#0f0f0f;color:#e8e8e8;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#1a1a1a;border:1px solid {color};border-radius:8px;padding:24px">
  <h2 style="color:{color};margin:0 0 16px">⚠️ [{severity}] Atenna Security Alert</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr><td style="color:#888;padding:4px 0">Event</td><td style="color:#fff;font-weight:700">{event_type}</td></tr>
    <tr><td style="color:#888;padding:4px 0">Time</td><td style="color:#aaa">{ts}</td></tr>
    <tr><td style="color:#888;padding:4px 0">User</td><td style="color:#aaa">{user}</td></tr>
    <tr><td style="color:#888;padding:4px 0">IP</td><td style="color:#aaa">{ip}</td></tr>
  </table>
  <pre style="background:#111;border:1px solid #333;border-radius:4px;padding:12px;font-size:11px;margin-top:16px;overflow-x:auto;color:#22c55e">{json.dumps(data, indent=2, default=str, ensure_ascii=False)}</pre>
  <p style="color:#555;font-size:11px;margin:16px 0 0">Atenna Guard · {ts} UTC · <a href="https://atennaplugin.maestro-n8n.site/admin/security/events" style="color:#6366f1">Ver logs</a></p>
</div>
</body></html>"""

        ok = await send_email(
            to=ADMIN_ALERT_EMAIL,
            subject=f"[{severity}] Atenna Security: {event_type}",
            html=html,
        )
        if ok:
            logger.info(f"[SecurityMonitor] Alert sent: {event_type} → {ADMIN_ALERT_EMAIL}")
        else:
            logger.warning(f"[SecurityMonitor] Alert send failed: {event_type}")

    except Exception as e:
        logger.error(f"[SecurityMonitor] Alert exception: {e}")


# ── Auth burst detector ───────────────────────────────────────────────────────

def record_auth_failure(ip: str, user_id: str = "") -> bool:
    """
    Record an auth failure for this IP.
    Returns True if burst threshold exceeded (should block/alert).
    """
    now = time.monotonic()
    dq  = _auth_failures.setdefault(ip, deque())

    # Expire old entries
    while dq and now - dq[0] > AUTH_BURST_WINDOW:
        dq.popleft()

    dq.append(now)
    count = len(dq)

    log_security_event(
        "auth_failure",
        {"failure_count_window": count, "threshold": AUTH_BURST_MAX},
        user_id=user_id,
        ip=ip,
    )

    if count >= AUTH_BURST_MAX:
        log_security_event(
            "auth_burst_detected",
            {"count": count, "window_secs": AUTH_BURST_WINDOW},
            user_id=user_id,
            ip=ip,
            severity="CRITICAL",
        )
        return True  # Caller should consider blocking

    return False


# ── Dashboard data ────────────────────────────────────────────────────────────

def get_recent_events(limit: int = 100, severity_filter: str | None = None) -> list[dict]:
    """Return recent security events from in-memory ring buffer."""
    events = list(_event_ring)
    if severity_filter:
        events = [e for e in events if e.get("severity") == severity_filter]
    return list(reversed(events))[-limit:]


def get_security_summary() -> dict:
    """Aggregated counts by severity and event type for the dashboard."""
    events = list(_event_ring)
    by_severity: dict[str, int] = {}
    by_type: dict[str, int] = {}

    for e in events:
        sev = e.get("severity", "INFO")
        typ = e.get("event", "unknown")
        by_severity[sev] = by_severity.get(sev, 0) + 1
        by_type[typ]     = by_type.get(typ, 0) + 1

    return {
        "total_events":  len(events),
        "by_severity":   by_severity,
        "top_events":    sorted(by_type.items(), key=lambda x: -x[1])[:10],
        "auth_failures_active_ips": len(_auth_failures),
        "alert_cooldowns": len(ALERT_COOLDOWN),
        "log_path":      str(SECURITY_LOG_PATH),
    }
