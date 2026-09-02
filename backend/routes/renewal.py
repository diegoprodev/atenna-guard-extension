"""
Renewal Job — Atenna Safe Prompt
Roda diariamente as 09:00 (America/Sao_Paulo).

Busca usuarios Pro com plan_expires_at em ~30 dias e envia email de renovacao.
Duplicatas evitadas via checkout_events (janela 2 dias).
"""
from __future__ import annotations
import os, logging
from datetime import datetime, timezone, timedelta
import httpx
from supabase import create_client
from routes.email_service import render_renewal, render_renewal_urgent, send_email

logger = logging.getLogger(__name__)

ASAAS_TOKEN           = os.getenv("ASAAS_API_TOKEN", "")
ASAAS_BASE            = os.getenv("ASAAS_BASE_URL", "https://api.asaas.com/v3")
VPS_BASE              = "https://api.atennaia.com.br"
RENEWAL_WINDOW_DAYS   = 30
RENEWAL_WINDOW_MARGIN = 1


def _supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    return create_client(url, key) if url and key else None


def _asaas_headers() -> dict:
    return {"access_token": ASAAS_TOKEN, "Content-Type": "application/json", "User-Agent": "Atenna-SafePrompt/2.0"}


async def _create_renewal_link(user_id: str, plan_key: str) -> str | None:
    PLANS = {
        "yearly":  {"price": 197.00, "name": "Atenna Safe Prompt Pro Anual - Renovacao 10x",  "installments": 10},
        "monthly": {"price":  29.90, "name": "Atenna Safe Prompt Pro Mensal - Renovacao",      "installments": 1},
    }
    plan = PLANS.get(plan_key, PLANS["yearly"])

    payload: dict = {
        "name":               plan["name"],
        "description":        "Renovacao do seu acesso Atenna Safe Prompt Pro.",
        "value":              plan["price"],
        "billingType":        "CREDIT_CARD" if plan["installments"] > 1 else "UNDEFINED",
        "chargeType":         "INSTALLMENT" if plan["installments"] > 1 else "RECURRENT",
        "dueDateLimitDays":   7,
        "externalReference":  user_id,
        "notificationEnabled": True,
        "successUrl":         f"{VPS_BASE}/checkout/success",
        "cancelUrl":          f"{VPS_BASE}/checkout/canceled",
    }
    if plan["installments"] > 1:
        payload["installmentCount"]    = plan["installments"]
        payload["maxInstallmentCount"] = plan["installments"]
    else:
        payload["subscriptionCycle"] = "MONTHLY"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{ASAAS_BASE}/paymentLinks",
                json=payload,
                headers=_asaas_headers(),
            )
            if resp.status_code in (200, 201):
                return resp.json().get("url")
            logger.warning(f"Asaas renewal link error {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.error(f"_create_renewal_link failed for {user_id}: {e}")
    return None


def _already_notified(sb, user_id: str, event_type: str = "renewal_reminder") -> bool:
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
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


async def _process_renewal_users(sb, users: list, event_type: str, days_label: str) -> dict:
    now = datetime.now(timezone.utc)
    notified = skipped = errors = 0

    for user in users:
        uid      = user["id"]
        email    = user.get("email", "")
        plan_key = user.get("plan_type", "yearly")

        if not email or _already_notified(sb, uid, event_type):
            skipped += 1
            continue

        try:
            exp_dt    = datetime.fromisoformat(user["plan_expires_at"].replace("Z", "+00:00"))
            days_left = max(1, (exp_dt - now).days)
        except Exception:
            days_left = int(days_label)

        renewal_url = await _create_renewal_link(uid, plan_key)
        if not renewal_url:
            errors += 1
            continue

        if event_type == "renewal_reminder":
            html    = render_renewal(email, days_left, renewal_url, plan_key)
            subject = f"Sua assinatura Atenna Safe Prompt vence em {days_left} dias"
        else:
            html    = render_renewal_urgent(email, days_left, renewal_url)
            subject = f"⚠️ Sua assinatura vence em {days_left} dias — renove agora"

        sent = await send_email(to=email, subject=subject, html=html)

        try:
            sb.table("checkout_events").upsert(
                {
                    "checkout_id": f"{event_type}_{uid}_{now.strftime('%Y%m%d')}",
                    "user_id":     uid,
                    "email":       email,
                    "event_type":  event_type,
                    "metadata":    {"days_left": days_left, "plan_key": plan_key, "renewal_url": renewal_url, "email_sent": sent},
                    "updated_at":  "now()",
                },
                on_conflict="checkout_id,event_type",
            ).execute()
        except Exception as e:
            logger.warning(f"[{event_type}] checkout_events log failed for {uid}: {e}")

        notified += 1 if sent else 0
        if not sent:
            skipped += 1

    return {"notified": notified, "skipped": skipped, "errors": errors, "total_found": len(users)}


async def run_renewal_check() -> dict:
    """Job L4 — vence em 30 dias. Chamado pelo scheduler as 09:00."""
    logger.info("[RENEWAL-30d] Starting")
    sb = _supabase()
    if not sb:
        return {"notified": 0, "skipped": 0, "errors": 1}

    now = datetime.now(timezone.utc)
    lo  = (now + timedelta(days=RENEWAL_WINDOW_DAYS - RENEWAL_WINDOW_MARGIN)).isoformat()
    hi  = (now + timedelta(days=RENEWAL_WINDOW_DAYS + RENEWAL_WINDOW_MARGIN)).isoformat()

    try:
        resp = sb.table("profiles").select("id, email, plan, plan_type, plan_expires_at").eq("plan", "pro").gte("plan_expires_at", lo).lte("plan_expires_at", hi).execute()
        users = resp.data or []
    except Exception as e:
        logger.error(f"[RENEWAL-30d] query failed: {e}")
        return {"notified": 0, "skipped": 0, "errors": 1}

    logger.info(f"[RENEWAL-30d] Found {len(users)} users")
    result = await _process_renewal_users(sb, users, "renewal_reminder", "30")
    logger.info(f"[RENEWAL-30d] Done: {result}")
    return result


async def run_renewal_urgent() -> dict:
    """Job L5 — vence em 7 dias. Chamado pelo scheduler as 09:00."""
    logger.info("[RENEWAL-7d] Starting")
    sb = _supabase()
    if not sb:
        return {"notified": 0, "skipped": 0, "errors": 1}

    now = datetime.now(timezone.utc)
    lo  = (now + timedelta(days=6)).isoformat()
    hi  = (now + timedelta(days=8)).isoformat()

    try:
        resp = sb.table("profiles").select("id, email, plan, plan_type, plan_expires_at").eq("plan", "pro").gte("plan_expires_at", lo).lte("plan_expires_at", hi).execute()
        users = resp.data or []
    except Exception as e:
        logger.error(f"[RENEWAL-7d] query failed: {e}")
        return {"notified": 0, "skipped": 0, "errors": 1}

    logger.info(f"[RENEWAL-7d] Found {len(users)} users")
    result = await _process_renewal_users(sb, users, "renewal_urgent", "7")
    logger.info(f"[RENEWAL-7d] Done: {result}")
    return result
