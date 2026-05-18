"""
Asaas Checkout -- PIX + Cartao de Credito (ate 10x)
Valor: R$197,00 / Atenna Pro

Eventos tratados:
  CHECKOUT_CREATED   -> salvar lead para recuperacao
  CHECKOUT_PAID      -> promover user para Pro (evento principal)
  CHECKOUT_CANCELED  -> registrar abandono
  CHECKOUT_EXPIRED   -> registrar abandono
  PAYMENT_RECEIVED   -> promover user (backup via cobrancas)
  PAYMENT_CONFIRMED  -> promover user (backup cartao)
"""
from __future__ import annotations
import os, logging, hmac
from datetime import date, timedelta
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from supabase import create_client
from middleware.auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/checkout", tags=["Checkout"])

ASAAS_TOKEN   = os.getenv("ASAAS_API_TOKEN", "")
ASAAS_BASE    = os.getenv("ASAAS_BASE_URL", "https://api.asaas.com/v3")
WEBHOOK_TOKEN = os.getenv("ASAAS_WEBHOOK_TOKEN", "")
VPS_BASE      = "https://atennaplugin.maestro-n8n.site"

PLANS = {
    # Pagamento unico — PIX ou cartao. Renovacao manual apos 1 ano.
    "yearly": {
        "price":         197.00,
        "name":          "Atenna Pro — Anual",
        "description":   "300 geracoes/mes, DLP ilimitado, historico completo. Valido por 12 meses.",
        "billing_types": ["PIX", "CREDIT_CARD"],
        "charge_types":  ["DETACHED"],
        "subscription":  None,
        "installment":   None,  # Asaas exibe opcoes de parcelamento na propria pagina
    },
    # Recorrente mensal — apenas cartao (limitacao Asaas: PIX nao suporta RECURRENT)
    "monthly": {
        "price":         29.90,
        "name":          "Atenna Pro — Mensal",
        "description":   "Acesso Pro com renovacao mensal automatica no cartao. Cancele quando quiser.",
        "billing_types": ["CREDIT_CARD"],
        "charge_types":  ["RECURRENT"],
        "subscription":  {"cycle": "MONTHLY"},
        "installment":   None,
    },
}

# Legacy alias — mantém compatibilidade com chamadas sem plano
PRODUCT_PRICE = 197.00
PRODUCT_NAME  = "Atenna Pro"
PRODUCT_DESC  = PLANS["yearly"]["description"]

def _asaas_headers():
    return {
        "access_token": ASAAS_TOKEN,
        "Content-Type": "application/json",
        "User-Agent": "Atenna-Guard/2.0",
    }

def _supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    return create_client(url, key) if url and key else None


# ─── POST /checkout/create ─────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    plan: str = "yearly"  # "yearly" | "monthly"

@router.post("/create")
async def create_checkout(body: CheckoutRequest = CheckoutRequest(), _user: dict = Depends(require_auth)):
    """Cria sessao de checkout Asaas. plan=yearly (R$197/ano) ou monthly (R$29,90/mes recorrente)."""
    plan_key = body.plan if body.plan in PLANS else "yearly"
    plan     = PLANS[plan_key]
    user_id  = _user.get("id") or _user.get("sub") or ""

    if not ASAAS_TOKEN:
        raise HTTPException(503, "Checkout temporariamente indisponivel.")

    payload: dict = {
        "billingTypes":      plan["billing_types"],
        "chargeTypes":       plan["charge_types"],
        "minutesToExpire":   1440,
        "externalReference": f"{user_id}:{plan_key}",
        "callback": {
            "successUrl": f"{VPS_BASE}/checkout/success?plan={plan_key}",
            "cancelUrl":  f"{VPS_BASE}/checkout/canceled",
            "expiredUrl": f"{VPS_BASE}/checkout/expired",
        },
        "items": [{
            "name":        plan["name"],
            "description": plan["description"],
            "quantity":    1,
            "value":       plan["price"],
        }],
    }

    if plan["subscription"]:
        sub = dict(plan["subscription"])
        sub["nextDueDate"] = (date.today() + timedelta(days=1)).isoformat()
        payload["subscription"] = sub

    if plan["installment"]:
        payload["installment"] = plan["installment"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{ASAAS_BASE}/checkouts",
                json=payload,
                headers=_asaas_headers(),
            )
        if resp.status_code not in (200, 201):
            logger.error(f"Asaas error {resp.status_code}: {resp.text[:300]}")
            raise HTTPException(502, "Erro ao criar checkout. Tente novamente.")
        data = resp.json()
        checkout_id = data.get("id")
        if not checkout_id:
            raise HTTPException(502, "Resposta invalida do gateway.")
        checkout_url = data.get("link") or f"https://www.asaas.com/checkoutSession/show/{checkout_id}"
        logger.info(f"Checkout created: {checkout_id} plan={plan_key} user={user_id}")
        return {"url": checkout_url, "id": checkout_id, "plan": plan_key}
    except httpx.TimeoutException:
        raise HTTPException(504, "Timeout ao conectar com o gateway.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_checkout error: {e}")
        raise HTTPException(500, "Erro interno.")


# ─── POST /webhook/asaas ───────────────────────────────────────────────────────

def _promote_to_pro(sb, user_id: str, payment_id: str, billing_type: str, value: float, event: str):
    """Upsert user_plans = pro e registra audit log."""
    sb.table("user_plans").upsert({
        "user_id":          user_id,
        "plan":             "pro",
        "updated_at":       "now()",
        "asaas_payment_id": payment_id,
    }, on_conflict="user_id").execute()

    sb.table("dlp_events").insert({
        "user_id":    user_id,
        "event_type": "plan_upgraded_to_pro",
        "metadata": {
            "payment_id":   payment_id,
            "billing_type": billing_type,
            "value":        value,
            "asaas_event":  event,
        },
    }).execute()
    logger.info(f"User {user_id} promoted to Pro via {event}")


def _save_checkout_event(sb, event_type: str, checkout_id: str, user_id: str, email: str, name: str, extra: dict):
    """Salva evento de checkout para rastreio de funil e recuperacao."""
    try:
        sb.table("checkout_events").upsert({
            "checkout_id": checkout_id,
            "user_id":     user_id or None,
            "email":       email or None,
            "name":        name or None,
            "event_type":  event_type,
            "metadata":    extra,
            "updated_at":  "now()",
        }, on_conflict="checkout_id,event_type").execute()
    except Exception as e:
        # Table may not exist yet -- log but don't fail
        logger.warning(f"checkout_events upsert failed (table may be missing): {e}")


@router.post("/webhook/asaas", include_in_schema=False)
async def asaas_webhook(request: Request):
    """
    Trata todos os eventos Asaas relevantes:
    - CHECKOUT_CREATED  -> salvar lead
    - CHECKOUT_PAID     -> promover Pro (evento principal do checkout)
    - CHECKOUT_CANCELED / CHECKOUT_EXPIRED -> registrar abandono
    - PAYMENT_RECEIVED / PAYMENT_CONFIRMED -> promover Pro (backup via cobrancas)
    """
    incoming = request.headers.get("asaas-access-token", "")
    if WEBHOOK_TOKEN and not hmac.compare_digest(incoming, WEBHOOK_TOKEN):
        raise HTTPException(403, "Forbidden")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    event    = body.get("event", "")
    payment  = body.get("payment", {})
    checkout = body.get("checkout", {})

    logger.info(f"Asaas webhook: event={event}")

    sb = _supabase()
    if not sb:
        return {"received": True, "action": "supabase_unavailable"}

    # ── Checkout events ──────────────────────────────────────────────────────
    if event == "CHECKOUT_CREATED":
        cid      = checkout.get("id", "")
        customer = checkout.get("customer", {}) or {}
        uid      = checkout.get("externalReference", "")
        email    = customer.get("email", "")
        name     = customer.get("name", "")
        _save_checkout_event(sb, "created", cid, uid, email, name, {
            "value": checkout.get("totalValue"),
            "billing_types": checkout.get("billingTypes"),
        })
        return {"received": True, "action": "lead_saved"}

    if event == "CHECKOUT_PAID":
        cid      = checkout.get("id", "")
        customer = checkout.get("customer", {}) or {}
        uid      = checkout.get("externalReference", "")
        email    = customer.get("email", "")
        name     = customer.get("name", "")
        pay_id   = checkout.get("paymentId", "")
        billing  = checkout.get("billingType", "")
        value    = checkout.get("totalValue", PRODUCT_PRICE)

        _save_checkout_event(sb, "paid", cid, uid, email, name, {
            "payment_id": pay_id, "billing_type": billing, "value": value,
        })

        if uid:
            try:
                _promote_to_pro(sb, uid, pay_id, billing, value, event)
            except Exception as e:
                logger.error(f"CHECKOUT_PAID promote error: {e}")
        return {"received": True, "action": "user_promoted"}

    if event in ("CHECKOUT_CANCELED", "CHECKOUT_EXPIRED"):
        cid      = checkout.get("id", "")
        customer = checkout.get("customer", {}) or {}
        uid      = checkout.get("externalReference", "")
        email    = customer.get("email", "")
        name     = customer.get("name", "")
        _save_checkout_event(sb, event.lower().replace("checkout_", ""), cid, uid, email, name, {})
        return {"received": True, "action": "abandonment_recorded"}

    # ── Payment events (backup) ───────────────────────────────────────────────
    if event in ("PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"):
        uid      = payment.get("externalReference", "")
        pay_id   = payment.get("id", "")
        billing  = payment.get("billingType", "")
        value    = payment.get("value", PRODUCT_PRICE)

        if not uid:
            return {"received": True, "action": "no_user_id"}
        try:
            _promote_to_pro(sb, uid, pay_id, billing, value, event)
        except Exception as e:
            logger.error(f"Payment promote error: {e}")
            return {"received": True, "action": "error"}
        return {"received": True, "action": "user_promoted_via_payment"}

    return {"received": True, "action": "ignored"}


# ─── Static redirect pages ────────────────────────────────────────────────────

_PAGE_STYLE = (
    "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
    "background:#0f0f0f;color:#e8e8e8;display:flex;align-items:center;"
    "justify-content:center;min-height:100vh}"
    ".box{text-align:center;max-width:480px;padding:48px 32px}"
    ".icon{font-size:48px;margin-bottom:24px}"
    "h1{font-size:22px;font-weight:600;margin:0 0 12px}"
    "p{font-size:14px;color:#999;line-height:1.6;margin:0 0 32px}"
    "a{display:inline-block;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:500;text-decoration:none}"
    ".btn-primary{background:#6366f1;color:#fff}"
    ".btn-secondary{border:1px solid #333;color:#aaa}"
)

@router.get("/success", response_class=HTMLResponse, include_in_schema=False)
async def checkout_success():
    return HTMLResponse(
        f'<!DOCTYPE html><html lang="pt-BR"><head>'
        f'<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>Pagamento confirmado</title><style>{_PAGE_STYLE}</style></head><body><div class="box">'
        f'<div class="icon">&#10003;</div>'
        f'<h1>Pagamento confirmado</h1>'
        f'<p>Seu acesso Pro ser&#225; ativado em instantes.<br>'
        f'Feche esta aba e atualize a extens&#227;o Atenna.</p>'
        f'<a href="javascript:window.close()" class="btn-primary">Fechar</a>'
        f'</div></body></html>'
    )

@router.get("/canceled", response_class=HTMLResponse, include_in_schema=False)
async def checkout_canceled():
    return HTMLResponse(
        f'<!DOCTYPE html><html lang="pt-BR"><head>'
        f'<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>Compra cancelada</title><style>{_PAGE_STYLE}</style></head><body><div class="box">'
        f'<div class="icon">&#10005;</div>'
        f'<h1>Compra cancelada</h1>'
        f'<p>Nenhuma cobran&#231;a foi realizada.<br>'
        f'Voc&#234; pode tentar novamente quando quiser.</p>'
        f'<a href="javascript:window.close()" class="btn-secondary">Fechar</a>'
        f'</div></body></html>'
    )

@router.get("/expired", response_class=HTMLResponse, include_in_schema=False)
async def checkout_expired():
    return HTMLResponse(
        f'<!DOCTYPE html><html lang="pt-BR"><head>'
        f'<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>Link expirado</title><style>{_PAGE_STYLE}</style></head><body><div class="box">'
        f'<div class="icon">&#8987;</div>'
        f'<h1>Link expirado</h1>'
        f'<p>O link de pagamento expirou ap&#243;s 24 horas.<br>'
        f'Abra a extens&#227;o Atenna e solicite um novo link.</p>'
        f'<a href="javascript:window.close()" class="btn-secondary">Fechar</a>'
        f'</div></body></html>'
    )
