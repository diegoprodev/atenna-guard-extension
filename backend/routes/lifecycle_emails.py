"""
Lifecycle Emails — Atenna Safe Prompt
Jobs de onboarding e upsell disparados pelo APScheduler.

L1 — Boas-vindas: POST /internal/email/welcome (webhook Supabase)
L2 — Onboarding D+1: cron diario 10:00
L3 — Upsell free->pro: cron diario 11:00
L7 — Pro welcome: chamado diretamente por _promote_to_pro()
"""
from __future__ import annotations
import os, logging
from datetime import datetime, timezone, timedelta
from supabase import create_client
from routes.email_service import (
    render_welcome,
    render_onboarding_d1,
    render_upsell_free_to_pro,
    render_pro_welcome,
    send_email,
)

logger = logging.getLogger(__name__)

FREE_DAILY_QUOTA = int(os.getenv("FREE_DAILY_QUOTA", "5"))


def _supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    return create_client(url, key) if url and key else None


def _already_sent(sb, user_id: str, event_type: str, days: int = 2) -> bool:
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        resp = (
            sb.table("checkout_events")
            .select("id")
            .eq("user_id", user_id)
            .eq("event_type", event_type)
            .gte("updated_at", cutoff)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception:
        return False


def _log_event(sb, user_id: str, email: str, event_type: str, metadata: dict) -> None:
    try:
        now = datetime.now(timezone.utc)
        sb.table("checkout_events").upsert(
            {
                "checkout_id": f"{event_type}_{user_id}_{now.strftime('%Y%m%d')}",
                "user_id":     user_id,
                "email":       email,
                "event_type":  event_type,
                "metadata":    metadata,
                "updated_at":  "now()",
            },
            on_conflict="checkout_id,event_type",
        ).execute()
    except Exception as e:
        logger.warning(f"[{event_type}] log failed for {user_id}: {e}")


# ---------------------------------------------------------------------------
# L1 — Boas-vindas (chamado pelo endpoint POST /internal/email/welcome)
# ---------------------------------------------------------------------------

async def send_welcome(user_id: str, email: str) -> bool:
    html = render_welcome(email)
    sent = await send_email(
        to=email,
        subject="Bem-vindo ao Atenna Safe Prompt! 🛡️",
        html=html,
    )
    sb = _supabase()
    if sb:
        _log_event(sb, user_id, email, "welcome_sent", {"email_sent": sent})
    return sent


# ---------------------------------------------------------------------------
# L2 — Onboarding D+1 (cron 10:00)
# ---------------------------------------------------------------------------

async def run_onboarding_d1() -> dict:
    logger.info("[ONBOARDING-D1] Starting")
    sb = _supabase()
    if not sb:
        return {"notified": 0, "skipped": 0, "errors": 1}

    now        = datetime.now(timezone.utc)
    window_lo  = (now - timedelta(days=2)).isoformat()
    window_hi  = (now - timedelta(days=1)).isoformat()

    try:
        resp = (
            sb.table("profiles")
            .select("id, email, created_at, prompt_count")
            .eq("plan", "free")
            .gte("created_at", window_lo)
            .lte("created_at", window_hi)
            .execute()
        )
        users = resp.data or []
    except Exception as e:
        logger.error(f"[ONBOARDING-D1] query failed: {e}")
        return {"notified": 0, "skipped": 0, "errors": 1}

    notified = skipped = errors = 0
    for user in users:
        uid   = user["id"]
        email = user.get("email", "")
        count = user.get("prompt_count", 0) or 0

        if not email or count > 0 or _already_sent(sb, uid, "onboarding_d1", days=3):
            skipped += 1
            continue

        html = render_onboarding_d1(email)
        sent = await send_email(
            to=email,
            subject="Você ainda não protegeu nenhum prompt 🤔",
            html=html,
        )
        _log_event(sb, uid, email, "onboarding_d1", {"email_sent": sent})
        notified += 1 if sent else 0
        if not sent:
            errors += 1

    result = {"notified": notified, "skipped": skipped, "errors": errors, "total_found": len(users)}
    logger.info(f"[ONBOARDING-D1] Done: {result}")
    return result


# ---------------------------------------------------------------------------
# L3 — Upsell free->pro (cron 11:00)
# ---------------------------------------------------------------------------

async def run_upsell() -> dict:
    logger.info("[UPSELL] Starting")
    sb = _supabase()
    if not sb:
        return {"notified": 0, "skipped": 0, "errors": 1}

    # Usuarios free que atingiram cota nos ultimos 3 dias
    now    = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=3)).isoformat()

    try:
        resp = (
            sb.table("dlp_events")
            .select("user_id, profiles!inner(email, plan)")
            .eq("profiles.plan", "free")
            .eq("event_type", "quota_exceeded")
            .gte("created_at", cutoff)
            .execute()
        )
        rows = resp.data or []
    except Exception as e:
        logger.error(f"[UPSELL] query failed: {e}")
        return {"notified": 0, "skipped": 0, "errors": 1}

    # Deduplica por user_id e conta quantas vezes bateu cota
    seen: dict[str, dict] = {}
    for row in rows:
        uid   = row["user_id"]
        email = (row.get("profiles") or {}).get("email", "")
        if uid not in seen:
            seen[uid] = {"email": email, "quota_count": 0}
        seen[uid]["quota_count"] += 1

    logger.info(f"[UPSELL] Found {len(seen)} users who hit quota")
    notified = skipped = errors = 0

    for uid, data in seen.items():
        email       = data["email"]
        quota_count = data["quota_count"]

        if not email or _already_sent(sb, uid, "upsell_sent", days=7):
            skipped += 1
            continue

        html = render_upsell_free_to_pro(email, quota_count)
        sent = await send_email(
            to=email,
            subject="Você atingiu seu limite — hora de ser Pro",
            html=html,
        )
        _log_event(sb, uid, email, "upsell_sent", {"quota_count": quota_count, "email_sent": sent})
        notified += 1 if sent else 0
        if not sent:
            errors += 1

    result = {"notified": notified, "skipped": skipped, "errors": errors, "total_found": len(seen)}
    logger.info(f"[UPSELL] Done: {result}")
    return result


# ---------------------------------------------------------------------------
# L7 — Pro welcome (chamado por _promote_to_pro() no checkout.py)
# ---------------------------------------------------------------------------

async def send_pro_welcome(user_id: str, email: str, plan_key: str, expires_at: str) -> bool:
    html = render_pro_welcome(email, plan_key, expires_at)
    sent = await send_email(
        to=email,
        subject="🎉 Você agora é Atenna Safe Prompt Pro!",
        html=html,
    )
    sb = _supabase()
    if sb:
        _log_event(sb, user_id, email, "pro_welcome_sent", {"plan_key": plan_key, "email_sent": sent})
    return sent
