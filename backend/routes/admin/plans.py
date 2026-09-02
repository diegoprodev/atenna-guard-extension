"""Pro plan management — reads/writes profiles table (source of truth)."""
import os, uuid, httpx
from datetime import datetime, timezone, timedelta
from utils.fx_rate import get_usd_brl
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from middleware.admin_auth import require_super_admin
from services.audit_service import record_audit_event

router = APIRouter()
SUPABASE_URL         = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')

CHECKOUT_BASE = 'https://api.atennaia.com.br/checkout/create'

PLAN_CONFIG = {
    'free': {
        'price_brl_monthly': 0,
        'price_brl_annual':  0,
        'quota_daily':       5,
        'features':          ['DLP básico', '5 prompts/dia'],
        'checkout_monthly':  None,
        'checkout_annual':   None,
    },
    'pro': {
        'price_brl_monthly': 29.90,
        'price_brl_annual':  197.00,
        'quota_daily':       500,
        'features':          ['DLP avançado', '500 prompts/dia', 'Histórico 30d', 'Export de dados'],
        'checkout_monthly':  f'{CHECKOUT_BASE}?plan=monthly',
        'checkout_annual':   f'{CHECKOUT_BASE}?plan=yearly',
    },

}

def _svc():
    return {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type':  'application/json',
    }


class PlanAssign(BaseModel):
    user_id:        str
    plan_type:      str
    billing_period: str  = 'monthly'   # monthly | annual
    status:         str  = 'active'
    notes:          str  = ''
    confirmed:      bool = False


class PlanStatusUpdate(BaseModel):
    status:    str
    notes:     str  = ''
    confirmed: bool = False


@router.get('/plans/config')
async def plan_config(_: dict = Depends(require_super_admin)):
    rate = await get_usd_brl()
    return {'plans': PLAN_CONFIG, 'usd_brl_rate': round(rate, 4)}


@router.get('/plans/users')
async def list_plan_users(
    plan_filter:   str = Query(''),
    status_filter: str = Query(''),
    search:        str = Query(''),
    admin: dict = Depends(require_super_admin),
):
    async with httpx.AsyncClient(timeout=10.0) as c:
        # Source of truth: profiles table
        r = await c.get(
            f'{SUPABASE_URL}/rest/v1/profiles'
            '?select=id,email,plan,plan_type,plan_expires_at,asaas_subscription_id,updated_at'
            '&order=updated_at.desc',
            headers=_svc(),
        )
        profiles = r.json() if r.is_success else []

        # user_plans for billing_period / status details
        r2 = await c.get(
            f'{SUPABASE_URL}/rest/v1/user_plans?select=user_id,billing_period,status,notes',
            headers=_svc(),
        )
        up_map = {x['user_id']: x for x in (r2.json() if r2.is_success else [])}

    now = datetime.now(timezone.utc)
    rows = []
    for p in profiles:
        uid       = p.get('id', '')
        email     = p.get('email', uid)
        plan      = p.get('plan', 'free') or 'free'
        plan_type = p.get('plan_type', plan) or plan
        exp_raw   = p.get('plan_expires_at')
        up        = up_map.get(uid, {})
        billing   = up.get('billing_period', 'monthly')
        status    = up.get('status', 'active')
        notes     = up.get('notes', '')

        # Derive status from expiry when not in user_plans
        if exp_raw:
            exp_dt = datetime.fromisoformat(exp_raw.replace('Z', '+00:00'))
            if exp_dt < now:
                status = 'expired'
            elif exp_dt < now + timedelta(days=7):
                status = 'expiring_soon'

        if plan_filter and plan != plan_filter:
            continue
        if status_filter and status != status_filter:
            continue
        if search and search.lower() not in email.lower():
            continue

        cfg = PLAN_CONFIG.get(plan, PLAN_CONFIG['free'])
        rows.append({
            'user_id':        uid,
            'email':          email,
            'plan_type':      plan,
            'plan_subtype':   plan_type,
            'billing_period': billing,
            'status':         status,
            'notes':          notes,
            'plan_expires_at': exp_raw,
            'updated_at':     p.get('updated_at'),
            'price_brl':      cfg['price_brl_annual'] / 12 if billing == 'annual' else cfg['price_brl_monthly'],
            'features':       cfg['features'],
            'quota_daily':    cfg['quota_daily'],
        })

    return {'data': rows, 'total': len(rows)}


@router.post('/plans/assign')
async def assign_plan(body: PlanAssign, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária.')
    if body.plan_type not in PLAN_CONFIG:
        raise HTTPException(400, 'Plano inválido. Opções: free, pro')

    # Calcular plan_expires_at se pro
    expires_at = None
    if body.plan_type != 'free':
        days = 365 if body.billing_period == 'annual' else 30
        expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()

    corr = str(uuid.uuid4())

    async with httpx.AsyncClient(timeout=8.0) as c:
        # 1. Atualizar profiles (fonte de verdade da extensão)
        profile_payload = {
            'plan':            body.plan_type,
            'plan_type':       body.billing_period if body.plan_type != 'free' else 'free',
            'plan_expires_at': expires_at,
            'updated_at':      'now()',
        }
        r1 = await c.patch(
            f'{SUPABASE_URL}/rest/v1/profiles?id=eq.{body.user_id}',
            headers={**_svc(), 'Prefer': 'return=representation'},
            json=profile_payload,
        )
        if not r1.is_success:
            raise HTTPException(502, f'Erro ao atualizar profiles: {r1.text[:200]}')

        # 2. Sincronizar user_plans (legado / admin view)
        r2 = await c.post(
            f'{SUPABASE_URL}/rest/v1/user_plans',
            headers={**_svc(), 'Prefer': 'resolution=merge-duplicates'},
            json={
                'user_id':        body.user_id,
                'plan_type':      body.plan_type,
                'billing_period': body.billing_period,
                'status':         body.status,
                'notes':          body.notes,
            },
        )
        # user_plans failure is non-fatal (table may differ)
        if not r2.is_success:
            import logging
            logging.getLogger(__name__).warning(f'user_plans sync failed: {r2.text[:100]}')

    await record_audit_event(
        admin['id'], 'plan.assign', body.user_id, None,
        {'plan': body.plan_type, 'billing': body.billing_period, 'status': body.status, 'expires_at': expires_at},
        corr,
    )
    return {'ok': True, 'correlation_id': corr, 'expires_at': expires_at}


@router.patch('/plans/{user_id}/status')
async def update_plan_status(user_id: str, body: PlanStatusUpdate, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária.')
    if body.status not in ('active', 'trialing', 'past_due', 'canceled', 'expired'):
        raise HTTPException(400, 'Status inválido.')

    corr = str(uuid.uuid4())

    # If canceling/expiring, clear plan in profiles
    profile_update = {'updated_at': 'now()'}
    if body.status in ('canceled', 'expired'):
        profile_update.update({'plan': 'free', 'plan_type': 'free', 'plan_expires_at': None})

    async with httpx.AsyncClient(timeout=8.0) as c:
        await c.patch(
            f'{SUPABASE_URL}/rest/v1/profiles?id=eq.{user_id}',
            headers={**_svc(), 'Prefer': 'return=representation'},
            json=profile_update,
        )
        r = await c.patch(
            f'{SUPABASE_URL}/rest/v1/user_plans?user_id=eq.{user_id}',
            headers={**_svc(), 'Prefer': 'return=representation'},
            json={'status': body.status, 'notes': body.notes},
        )

    if not r.is_success:
        raise HTTPException(502, 'Erro ao atualizar status.')

    await record_audit_event(
        admin['id'], 'plan.status_update', user_id, None,
        {'status': body.status, 'notes': body.notes}, corr,
    )
    return {'ok': True, 'correlation_id': corr}
