"""
Asaas Subscriptions - PIX + Cartao de Credito (recorrente)

Dois fluxos de compra:
  1. EXTENSAO (usuario logado)
       POST /checkout/create -> link com externalReference=user_id
       Webhook recebe externalReference -> promove diretamente.

  2. LANDING PAGE (link estatico)
       GET  /checkout/links -> URLs fixas criadas no Asaas
       Usuario paga -> webhook busca email no Asaas -> acha ou cria conta -> promove.

Tabelas:
  profiles, user_plans, subscriptions, checkout_events, dlp_events
"""
from __future__ import annotations
import os, logging, hmac
from datetime import datetime, timezone, timedelta
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from supabase import create_client
from middleware.auth import require_auth
try:
    from security.monitor import log_security_event
except ImportError:
    def log_security_event(*a, **kw): pass


from routes.lifecycle_emails import send_pro_welcome as _send_pro_welcome_email
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/checkout", tags=["Checkout"])

from pydantic import BaseModel
class CheckoutBody(BaseModel):
    plan: str = "yearly"

ASAAS_TOKEN   = os.getenv("ASAAS_API_TOKEN", "")
ASAAS_BASE    = os.getenv("ASAAS_BASE_URL", "https://api.asaas.com/v3")
WEBHOOK_TOKEN = os.getenv("ASAAS_WEBHOOK_TOKEN", "")
VPS_BASE      = "https://atennaplugin.maestro-n8n.site"

LINK_MONTHLY_URL = os.getenv("ASAAS_LINK_MONTHLY_URL", "")
LINK_YEARLY_URL      = os.getenv("ASAAS_LINK_YEARLY_URL",      "")
LINK_INSTALLMENT_URL = os.getenv("ASAAS_LINK_INSTALLMENT_URL", "")

PLANS = {
    "yearly":     {"price": 197.00, "name": "Atenna Pro Anual",         "cycle": "YEARLY",  "days": 365},
    "monthly":    {"price":  29.90, "name": "Atenna Pro Mensal",        "cycle": "MONTHLY", "days": 30},
    "pix_yearly": {"price": 197.00, "name": "Atenna Pro Anual via PIX", "cycle": "YEARLY",  "days": 365},
}

def _asaas_headers() -> dict:
    return {"access_token": ASAAS_TOKEN, "Content-Type": "application/json", "User-Agent": "Atenna-Guard/2.0"}

def _supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    return create_client(url, key) if url and key else None

def _infer_plan_from_value(value: float) -> str:
    return "monthly" if abs(value - PLANS["monthly"]["price"]) < 1.0 else "yearly"

def _get_user_id_from_subscription(sb, subscription_id: str) -> str | None:
    try:
        resp = sb.table("profiles").select("id").eq("asaas_subscription_id", subscription_id).maybe_single().execute()
        if resp and resp.data:
            return resp.data.get("id")
    except Exception:
        pass
    return None

async def _fetch_asaas_customer(customer_id: str) -> dict:
    """Busca email e nome do cliente no Asaas. Usado para pagamentos de links estaticos."""
    if not customer_id:
        return {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{ASAAS_BASE}/customers/{customer_id}", headers=_asaas_headers())
            if resp.status_code == 200:
                d = resp.json()
                return {"email": d.get("email", ""), "name": d.get("name", "")}
    except Exception as e:
        logger.warning(f"Asaas customer fetch failed {customer_id}: {e}")
    return {}

def _find_or_create_supabase_user(sb, email: str, name: str) -> tuple[str, bool]:
    """
    Retorna (user_id, is_new).
    - Se email existe em profiles: retorna user_id existente.
    - Se nao existe: cria conta via invite_user_by_email (Supabase envia email de acesso).
    """
    if not email:
        return "", False
    try:
        resp = sb.table("profiles").select("id").eq("email", email).maybe_single().execute()
        if resp and resp.data:
            logger.info(f"Existing user found: {email}")
            return resp.data["id"], False
    except Exception as e:
        logger.warning(f"profiles email lookup: {e}")

    try:
        result = sb.auth.admin.invite_user_by_email(
            email,
            options={"data": {"full_name": name or email.split("@")[0], "source": "asaas_checkout"}},
        )
        user_id = result.user.id
        sb.table("profiles").upsert(
            {"id": user_id, "email": email, "plan": "free", "updated_at": "now()"},
            on_conflict="id",
        ).execute()
        logger.info(f"New user created via checkout: {email} id={user_id}")
        return user_id, True
    except Exception as e:
        logger.error(f"invite_user_by_email failed for {email}: {e}")
        return "", False

def _promote_to_pro(sb, user_id: str, plan_key: str, payment_id: str, billing: str,
                    value: float, event: str, sub_id: str = "", email: str = "") -> None:
    plan       = PLANS.get(plan_key, PLANS["yearly"])
    expires_at = (datetime.now(timezone.utc) + timedelta(days=plan["days"])).isoformat()

    sb.table("profiles").update({
        "plan": "pro", "plan_type": plan_key, "plan_expires_at": expires_at, "updated_at": "now()",
    }).eq("id", user_id).execute()

    try:
        sb.table("user_plans").upsert({
            "user_id": user_id, "plan_type": "pro", "status": "active",
            "billing_period": plan_key, "plan_expires_at": expires_at,
            "asaas_subscription_id": sub_id or None, "updated_at": "now()",
        }, on_conflict="user_id").execute()
    except Exception as e:
        logger.warning(f"user_plans upsert: {e}")

    try:
        sb.table("subscriptions").update(
            {"plan":"pro","status":"active","valid_until":expires_at,"updated_at":"now()"}
        ).eq("user_id", user_id).execute()
    except Exception as e:
        logger.warning(f"subscriptions update: {e}")

    try:
        sb.table("dlp_events").insert({
            "user_id": user_id, "event_type": "plan_upgraded_to_pro",
            "risk_level": "UNKNOWN",
            "metadata": {"payment_id": payment_id, "billing_type": billing, "value": value,
                         "plan_key": plan_key, "expires_at": expires_at, "asaas_event": event,
                         "sub_id": sub_id, "email": email},
        }).execute()
    except Exception as e:
        logger.warning(f"dlp_events audit: {e}")

    logger.info(f"User {user_id} ({email}) promoted to Pro ({plan_key}) via {event}, expires {expires_at}")

    # L7 — Pro welcome email (async, non-blocking)
    if email:
        import asyncio
        try:
            asyncio.ensure_future(_send_pro_welcome_email(user_id, email, plan_key, expires_at))
        except RuntimeError:
            pass  # no running event loop in sync context — email skipped

def _downgrade_to_free(sb, user_id: str, reason: str) -> None:
    sb.table("profiles").update({
        "plan": "free", "plan_type": "free", "plan_expires_at": None, "updated_at": "now()",
    }).eq("id", user_id).execute()

    for table, data in [
        ("user_plans",     {"user_id": user_id, "plan_type": "free", "status": "canceled", "updated_at": "now()"}),
        ("subscriptions",  None),
    ]:
        try:
            if data:
                sb.table(table).upsert(data, on_conflict="user_id").execute()
            else:
                sb.table(table).update({"status": "cancelled", "updated_at": "now()"}).eq("user_id", user_id).execute()
        except Exception as e:
            logger.warning(f"{table} downgrade: {e}")

    try:
        sb.table("dlp_events").insert({
            "user_id": user_id, "event_type": "plan_downgraded_to_free", "metadata": {"reason": reason},
        }).execute()
    except Exception as e:
        logger.warning(f"dlp_events downgrade: {e}")

    logger.info(f"User {user_id} downgraded to free: {reason}")

def _mark_past_due(sb, user_id: str, payment_id: str) -> None:
    try:
        sb.table("user_plans").upsert(
            {"user_id": user_id, "status": "past_due", "updated_at": "now()"}, on_conflict="user_id"
        ).execute()
    except Exception as e:
        logger.warning(f"user_plans past_due: {e}")
    try:
        sb.table("dlp_events").insert({
            "user_id": user_id, "event_type": "payment_overdue", "metadata": {"payment_id": payment_id},
        }).execute()
    except Exception as e:
        logger.warning(f"dlp_events overdue: {e}")


# ---------------------------------------------------------------------------
# GET /checkout/links
# ---------------------------------------------------------------------------

@router.get("/links")
async def get_checkout_links():
    """URLs dos links fixos de pagamento para landing pages. Sem autenticacao."""
    if not LINK_MONTHLY_URL or not LINK_YEARLY_URL:
        raise HTTPException(503, "Links de checkout nao configurados.")
    return {
        "monthly":     {"url": LINK_MONTHLY_URL,    "price": PLANS["monthly"]["price"]},
        "yearly":      {"url": LINK_YEARLY_URL,     "price": PLANS["yearly"]["price"]},
        "pix_yearly":  {"url": None, "price": PLANS["pix_yearly"]["price"], "type": "pix", "description": "PIX à vista — 12 meses"},
        "installment": {"url": LINK_INSTALLMENT_URL, "price": 197.0, "installments": 10, "installment_value": 19.70},
    }


# ---------------------------------------------------------------------------
# POST /checkout/create
# ---------------------------------------------------------------------------

@router.post("/create")
async def create_checkout(body: CheckoutBody = CheckoutBody(), _user: dict = Depends(require_auth)):
    """Link personalizado com externalReference=user_id. Usado pela extensao (usuario logado)."""
    user_id = _user.get("id") or _user.get("sub") or ""
    email   = _user.get("email", "")
    name    = (_user.get("user_metadata", {}).get("full_name")
               or _user.get("user_metadata", {}).get("name")
               or email.split("@")[0])

    if not ASAAS_TOKEN:
        raise HTTPException(503, "Checkout temporariamente indisponivel.")

    plan_key = body.plan if body.plan in PLANS else "yearly"
    plan     = PLANS[plan_key]
    is_pix   = plan_key == "pix_yearly"

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            if is_pix:
                # PIX: pagamento único anual (avista) via Checkout DETACHED
                payload = {
                    "billingTypes": ["PIX"],
                    "chargeTypes": ["DETACHED"],
                    "minutesToExpire": 1440,  # 24h para o cliente pagar
                    "callback": {
                        "successUrl": f"{VPS_BASE}/checkout/success",
                        "cancelUrl":  f"{VPS_BASE}/checkout/canceled",
                        "expiredUrl": f"{VPS_BASE}/checkout/expired",
                    },
                    "items": [
                        {
                            "name": plan["name"],
                            "description": "Acesso completo ao Atenna Pro por 12 meses. Pagamento único à vista via PIX.",
                            "quantity": 1,
                            "value": plan["price"],
                        }
                    ],
                    "customerData": {
                        "email": email,
                        "name":  name,
                    } if email else None,
                }
                # Remove customerData if empty
                if not payload.get("customerData", {}).get("email"):
                    payload.pop("customerData", None)

                resp = await client.post(
                    f"{ASAAS_BASE}/checkouts",
                    json={k: v for k, v in payload.items() if v is not None},
                    headers=_asaas_headers(),
                )
                if resp.status_code not in (200, 201):
                    logger.error(f"Asaas PIX checkout error {resp.status_code}: {resp.text[:300]}")
                    raise HTTPException(502, "Erro ao criar checkout PIX.")

                checkout_data = resp.json()
                sub_id       = checkout_data.get("id", "")
                payment_link = checkout_data.get("url", "")

            else:
                # Cartão: assinatura recorrente via paymentLinks
                resp = await client.post(
                    f"{ASAAS_BASE}/paymentLinks",
                    json={
                        "name":              plan["name"],
                        "description":       f"Atenna Pro - acesso completo. Renovação {plan['cycle'].lower()}.",
                        "value":             plan["price"],
                        "billingType":       "CREDIT_CARD",
                        "chargeType":        "RECURRENT",
                        "subscriptionCycle": plan["cycle"],
                        "dueDateLimitDays":  3,
                        "externalReference": user_id,
                        "notificationEnabled": True,
                        "successUrl": f"{VPS_BASE}/checkout/success",
                        "cancelUrl":  f"{VPS_BASE}/checkout/canceled",
                    },
                    headers=_asaas_headers(),
                )
                if resp.status_code not in (200, 201):
                    logger.error(f"Asaas paymentLink error {resp.status_code}: {resp.text[:300]}")
                    raise HTTPException(502, "Erro ao criar link de pagamento.")

                link         = resp.json()
                sub_id       = link.get("id", "")
                payment_link = link.get("url", "")

        sb = _supabase()
        if sb and user_id:
            try:
                sb.table("checkout_events").upsert({
                    "checkout_id": sub_id, "user_id": user_id, "email": email, "name": name,
                    "event_type": "initiated",
                    "metadata": {"plan": plan_key, "payment_link": payment_link},
                    "updated_at": "now()",
                }, on_conflict="checkout_id,event_type").execute()
            except Exception as e:
                logger.warning(f"checkout_events initiated: {e}")

        logger.info(f"Checkout link created: {sub_id} user={user_id} plan={plan_key}")
        return {"url": payment_link, "id": sub_id, "plan": plan_key}

    except httpx.TimeoutException:
        raise HTTPException(504, "Timeout ao conectar com gateway.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_checkout error: {e}")
        raise HTTPException(500, "Erro interno.")


# ---------------------------------------------------------------------------
# POST /webhook/asaas
# ---------------------------------------------------------------------------

@router.post("/webhook/asaas", include_in_schema=False)
async def asaas_webhook(request: Request):
    incoming = request.headers.get("asaas-access-token", "")
    # Fail-secure: se ASAAS_WEBHOOK_TOKEN não estiver configurado, rejeitar TUDO
    if not WEBHOOK_TOKEN:
        logger.critical("ASAAS_WEBHOOK_TOKEN not configured — rejecting webhook (fail-secure)")
        log_security_event("webhook_token_missing", {"action": "rejected_fail_secure"}, severity="CRITICAL")
        raise HTTPException(503, "Webhook token not configured")
    if not hmac.compare_digest(incoming, WEBHOOK_TOKEN):
        logger.warning(f"Webhook auth failed — invalid token")
        log_security_event("webhook_auth_failed", {"token_len": len(incoming)}, severity="CRITICAL")
        raise HTTPException(403, "Forbidden")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    event        = body.get("event", "")
    payment      = body.get("payment") or {}
    subscription = body.get("subscription") or {}
    checkout_obj = body.get("checkout") or {}

    logger.info(f"Asaas webhook received: event={event}")

    sb = _supabase()
    if not sb:
        return {"received": True, "action": "supabase_unavailable"}

    # PAYMENT_RECEIVED / PAYMENT_CONFIRMED
    if event in ("PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"):
        uid         = payment.get("externalReference", "")
        pay_id      = payment.get("id", "")
        sub_id      = payment.get("subscription", "")
        customer_id = payment.get("customer", "")
        billing     = payment.get("billingType", "")
        value       = float(payment.get("value", 0))
        is_new      = False
        email       = ""

        if uid:
            logger.info(f"Extension flow: uid={uid}")

        if not uid and sub_id:
            uid = _get_user_id_from_subscription(sb, sub_id) or ""

        if not uid and customer_id:
            logger.info(f"Landing page flow: fetching customer {customer_id}")
            customer = await _fetch_asaas_customer(customer_id)
            email    = customer.get("email", "")
            name     = customer.get("name", "")
            if email:
                uid, is_new = _find_or_create_supabase_user(sb, email, name)
            else:
                logger.warning(f"Could not resolve email for customer {customer_id}")

        if not uid:
            logger.warning(f"Payment {pay_id} sem user_id - ignorado")
            return {"received": True, "action": "no_user_id"}

        plan_key = _infer_plan_from_value(value)
        try:
            _promote_to_pro(sb, uid, plan_key, pay_id, billing, value, event, sub_id=sub_id, email=email)
        except Exception as e:
            logger.error(f"promote_to_pro error: {e}")
            return {"received": True, "action": "error"}

        try:
            sb.table("checkout_events").upsert({
                "checkout_id": sub_id or pay_id, "user_id": uid, "email": email,
                "event_type": "paid",
                "metadata": {"payment_id": pay_id, "value": value, "plan": plan_key, "is_new_user": is_new},
                "updated_at": "now()",
            }, on_conflict="checkout_id,event_type").execute()
        except Exception as e:
            logger.warning(f"checkout_events paid: {e}")

        return {"received": True, "action": "user_promoted", "plan": plan_key, "is_new_user": is_new}

    # PAYMENT_OVERDUE
    if event == "PAYMENT_OVERDUE":
        pay_id      = payment.get("id", "")
        uid         = payment.get("externalReference", "")
        sub_id      = payment.get("subscription", "")
        customer_id = payment.get("customer", "")

        if not uid and sub_id:
            uid = _get_user_id_from_subscription(sb, sub_id) or ""
        if not uid and customer_id:
            c = await _fetch_asaas_customer(customer_id)
            if c.get("email"):
                try:
                    r = sb.table("profiles").select("id").eq("email", c["email"]).maybe_single().execute()
                    uid = r.data.get("id", "") if r and r.data else ""
                except Exception:
                    pass

        if uid:
            _mark_past_due(sb, uid, pay_id)
        else:
            logger.warning(f"PAYMENT_OVERDUE sem user_id: {pay_id}")
        return {"received": True, "action": "overdue_logged"}

    # SUBSCRIPTION_CANCELLED
    if event == "SUBSCRIPTION_CANCELLED":
        sub_id = subscription.get("id", "")
        uid    = subscription.get("externalReference", "")
        if not uid and sub_id:
            uid = _get_user_id_from_subscription(sb, sub_id) or ""
        if uid:
            try:
                _downgrade_to_free(sb, uid, f"SUBSCRIPTION_CANCELLED sub={sub_id}")
            except Exception as e:
                logger.error(f"downgrade_to_free: {e}")
        else:
            logger.warning(f"SUBSCRIPTION_CANCELLED sem user_id sub={sub_id}")
        return {"received": True, "action": "user_downgraded"}

    # SUBSCRIPTION_CREATED
    if event == "SUBSCRIPTION_CREATED":
        sub_id   = subscription.get("id", "")
        uid      = subscription.get("externalReference", "")
        if uid:
            try:
                sb.table("subscriptions").upsert({
                    "user_id": uid, "plan": "pro", "status": "pending",
                    "provider": "asaas", "updated_at": "now()",
                }, on_conflict="user_id").execute()
            except Exception as e:
                logger.warning(f"subscriptions SUBSCRIPTION_CREATED: {e}")
        return {"received": True, "action": "subscription_registered"}

    # CHECKOUT_PAID (legado)
    if event == "CHECKOUT_PAID":
        uid     = checkout_obj.get("externalReference", "")
        pay_id  = checkout_obj.get("paymentId", "")
        billing = checkout_obj.get("billingType", "")
        value   = float(checkout_obj.get("totalValue", PLANS["yearly"]["price"]))
        if uid:
            plan_key = _infer_plan_from_value(value)
            try:
                _promote_to_pro(sb, uid, plan_key, pay_id, billing, value, event)
            except Exception as e:
                logger.error(f"CHECKOUT_PAID: {e}")
        return {"received": True, "action": "user_promoted_legacy"}

    logger.info(f"Webhook event ignored: {event}")
    return {"received": True, "action": "ignored"}


# ---------------------------------------------------------------------------
# GET /admin/plans
# ---------------------------------------------------------------------------

@router.get("/admin/plans")
async def admin_plan_list(
    plan_type: str | None = None, expiring_days: int = 0,
    limit: int = 100, offset: int = 0, _user: dict = Depends(require_auth),
):
    # Admin emails from env var — never hardcode in source
    admin_emails = set(e.strip() for e in os.getenv("ADMIN_EMAILS", "devdiegopro@gmail.com").split(",") if e.strip())
    requester_email = _user.get("email", "")
    if requester_email not in admin_emails:
        log_security_event("admin_access_denied", {"endpoint": "/admin/plans"}, user_id=requester_email, severity="CRITICAL")
        raise HTTPException(403, "Acesso restrito.")
    log_security_event("admin_access_granted", {"endpoint": "/admin/plans"}, user_id=requester_email, severity="CRITICAL")

    sb = _supabase()
    if not sb:
        raise HTTPException(503, "Indisponivel")

    query = sb.table("profiles").select(
        "id, email, plan, plan_type, plan_expires_at, asaas_subscription_id, created_at, updated_at"
    )
    if plan_type:
        query = query.eq("plan_type", plan_type)
    if expiring_days > 0:
        cutoff = (datetime.now(timezone.utc) + timedelta(days=expiring_days)).isoformat()
        query  = query.gte("plan_expires_at", datetime.now(timezone.utc).isoformat()).lte("plan_expires_at", cutoff)

    resp = query.range(offset, offset + limit - 1).order("plan_expires_at", desc=True, nullsfirst=False).execute()
    rows = resp.data or []
    now  = datetime.now(timezone.utc)
    for row in rows:
        exp = row.get("plan_expires_at")
        if not exp:
            row["subscription_status"] = "free"
        else:
            exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            row["subscription_status"] = (
                "expired"        if exp_dt < now else
                "expiring_soon"  if exp_dt < now + timedelta(days=7) else
                "active"
            )
    return {"total": len(rows), "offset": offset, "limit": limit, "data": rows}


# ---------------------------------------------------------------------------
# Paginas pos-checkout
# ---------------------------------------------------------------------------

_PAGE_STYLE = (
    "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
    "background:#0f0f0f;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh}"
    ".box{text-align:center;max-width:480px;padding:48px 32px}"
    ".icon{font-size:56px;margin-bottom:24px}"
    "h1{font-size:22px;font-weight:600;margin:0 0 12px}"
    "p{font-size:15px;color:#999;line-height:1.65;margin:0 0 32px}"
    "button{padding:12px 28px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none}"
    ".g{background:#22c55e;color:#000} .s{background:transparent;border:1px solid #333;color:#aaa}"
)

@router.get("/success", response_class=HTMLResponse, include_in_schema=False)
async def checkout_success():
    return HTMLResponse(
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>Pagamento confirmado</title><style>{_PAGE_STYLE}</style></head>"
        "<body><div class='box'><div class='icon'>&#9989;</div>"
        "<h1>Pagamento confirmado!</h1>"
        "<p>Seu acesso Pro sera ativado em instantes.<br>"
        "Se voce criou sua conta agora, verifique seu e-mail para definir sua senha.</p>"
        "<button onclick='window.close()' class='g'>Fechar e usar Atenna</button>"
        "</div></body></html>"
    )

@router.get("/canceled", response_class=HTMLResponse, include_in_schema=False)
async def checkout_canceled():
    return HTMLResponse(
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>"
        f"<title>Compra cancelada</title><style>{_PAGE_STYLE}</style></head>"
        "<body><div class='box'><div class='icon'>&#10005;</div>"
        "<h1>Compra cancelada</h1>"
        "<p>Nenhuma cobranca foi realizada. Voce pode assinar quando quiser.</p>"
        "<button onclick='window.close()' class='s'>Fechar</button>"
        "</div></body></html>"
    )

@router.get("/expired", response_class=HTMLResponse, include_in_schema=False)
async def checkout_expired():
    return HTMLResponse(
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>"
        f"<title>Link expirado</title><style>{_PAGE_STYLE}</style></head>"
        "<body><div class='box'><div class='icon'>&#8987;</div>"
        "<h1>Link expirado</h1>"
        "<p>Abra a extensao Atenna e solicite um novo link.</p>"
        "<button onclick='window.close()' class='s'>Fechar</button>"
        "</div></body></html>"
    )
