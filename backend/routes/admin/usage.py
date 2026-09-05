"""Cost + token usage per user — combines auth.users, dlp_stats, CF Gateway logs."""
import os, httpx
from utils.fx_rate import get_usd_brl
from services.llm_pricing import cost_usd
from fastapi import APIRouter, Depends, Query
from middleware.admin_auth import require_super_admin

router = APIRouter()
SUPABASE_URL      = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
CF_TOKEN          = os.getenv('CF_AIG_TOKEN', '')
CF_ACCOUNT_ID     = os.getenv('CF_ACCOUNT_ID', '')
CF_GATEWAY_ID     = os.getenv('CF_GATEWAY_ID', 'atenna-safe-plugin')

def _svc():
    return {'apikey': SUPABASE_SERVICE_KEY, 'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'}

@router.get('/usage')
async def usage_per_user(
    search: str = Query('', max_length=100),
    sort: str = Query('cost_desc'),
    admin: dict = Depends(require_super_admin),
):
    USD_BRL = await get_usd_brl()
    async with httpx.AsyncClient(timeout=12.0) as c:
        # All users
        r = await c.get(f'{SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000', headers=_svc())
        users = {u['id']: u for u in r.json().get('users', [])} if r.is_success else {}

        # DLP stats per user
        r2 = await c.get(
            f'{SUPABASE_URL}/rest/v1/user_dlp_stats?select=user_id,scans_total,protected_count,tokens_estimated',
            headers=_svc()
        )
        dlp_by_user = {x['user_id']: x for x in (r2.json() if r2.is_success else [])}

        # User plans
        r3 = await c.get(f'{SUPABASE_URL}/rest/v1/user_plans?select=user_id,plan_type', headers=_svc())
        plans = {x['user_id']: x['plan_type'] for x in (r3.json() if r3.is_success else [])}

        # CF logs — group cost by user via metadata if available, else allocate evenly
        cf_cost_by_user: dict[str, float] = {}
        cf_tokens_by_user: dict[str, int] = {}
        if CF_TOKEN:
            try:
                r4 = await c.get(
                    f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}'
                    f'/ai-gateway/gateways/{CF_GATEWAY_ID}/logs?limit=1000',
                    headers={'Authorization': f'Bearer {CF_TOKEN}'}
                )
                if r4.is_success:
                    logs = r4.json().get('result', [])
                    for l in logs:
                        # Try to get user_id from metadata
                        meta = l.get('metadata') or {}
                        uid = meta.get('user_id', '__shared__')
                        ti = l.get('tokens_in') or 0
                        to_ = l.get('tokens_out') or 0
                        cost = cost_usd(l.get('provider', ''), ti, to_)
                        cf_cost_by_user[uid] = cf_cost_by_user.get(uid, 0.0) + cost
                        cf_tokens_by_user[uid] = cf_tokens_by_user.get(uid, 0) + ti + to_
            except Exception:
                pass

    # Build rows
    rows = []
    for uid, u in users.items():
        email = u.get('email', '')
        if search and search.lower() not in email.lower():
            continue
        dlp = dlp_by_user.get(uid, {})
        scans = dlp.get('scans_total', 0)
        tokens_dlp = dlp.get('tokens_estimated', 0)
        protected = dlp.get('protected_count', 0)
        user_cost_usd = round(cf_cost_by_user.get(uid, 0.0), 6)
        tokens_cf = cf_tokens_by_user.get(uid, 0)

        rows.append({
            'user_id':       uid,
            'email':         email,
            'plan':          plans.get(uid, 'free'),
            'role':          u.get('app_metadata', {}).get('role', ''),
            'last_sign_in':  u.get('last_sign_in_at'),
            'scans_total':   scans,
            'protected':     protected,
            'tokens_dlp':    tokens_dlp,
            'tokens_cf':     tokens_cf,
            'cost_usd':      user_cost_usd,
            'cost_brl':      round(user_cost_usd * USD_BRL, 2),
        })

    # Sort
    key_map = {
        'cost_desc':   lambda r: -r['cost_usd'],
        'cost_asc':    lambda r:  r['cost_usd'],
        'scans_desc':  lambda r: -r['scans_total'],
        'tokens_desc': lambda r: -r['tokens_cf'],
        'email_asc':   lambda r:  r['email'],
    }
    rows.sort(key=key_map.get(sort, key_map['cost_desc']))

    total_cost_usd = round(sum(r['cost_usd'] for r in rows), 6)
    total_tokens   = sum(r['tokens_cf'] or r['tokens_dlp'] for r in rows)

    return {
        'data':            rows,
        'total_users':     len(rows),
        'total_cost_usd':  total_cost_usd,
        'total_cost_brl':  round(total_cost_usd * USD_BRL, 2),
        'total_tokens':    total_tokens,
        'usd_brl_rate':    USD_BRL,
    }
