import os, httpx
from fastapi import APIRouter, Depends
from middleware.admin_auth import require_super_admin

router = APIRouter()

SUPABASE_URL       = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
CF_TOKEN           = os.getenv('CF_AIG_TOKEN', '')
CF_ACCOUNT_ID      = os.getenv('CF_ACCOUNT_ID', 'e6d552f924497f01ac4a986ef8f8c342')
CF_GATEWAY_ID      = os.getenv('CF_GATEWAY_ID', 'atenna-safe-plugin')

COST_PER_1K = {'gemini': 0.00015, 'openai': 0.00200}

# USD per 1k tokens by provider prefix
PROVIDER_COST = {
    'google-ai-studio': 0.00015,
    'openai': 0.00200,
}


async def _fetch_cf_metrics() -> dict | None:
    if not CF_TOKEN:
        return None
    url = (
        f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}'
        f'/ai-gateway/gateways/{CF_GATEWAY_ID}/logs?limit=1000&order_by=created_at&direction=desc'
    )
    try:
        async with httpx.AsyncClient(timeout=12.0) as c:
            r = await c.get(url, headers={'Authorization': f'Bearer {CF_TOKEN}'})
        if not r.is_success:
            return {'error': f'CF API {r.status_code}', 'totals': None, 'by_provider': {}}
        logs = r.json().get('result', [])

        totals = {
            'requests_total': len(logs),
            'requests_errored': sum(1 for l in logs if not l.get('success', True)),
            'requests_cached': sum(1 for l in logs if l.get('cached', False)),
            'tokens_in': sum(l.get('tokens_in') or 0 for l in logs),
            'tokens_out': sum(l.get('tokens_out') or 0 for l in logs),
            'cost_usd': 0.0,
        }

        by_provider: dict = {}
        for l in logs:
            p = l.get('provider', 'unknown')
            m = l.get('model', 'unknown')
            ti = l.get('tokens_in') or 0
            to_ = l.get('tokens_out') or 0
            cost = (ti + to_) / 1000 * PROVIDER_COST.get(p, 0.001)

            if p not in by_provider:
                by_provider[p] = {'requests': 0, 'tokens_in': 0, 'tokens_out': 0, 'cost_usd': 0.0, 'model': m}
            by_provider[p]['requests'] += 1
            by_provider[p]['tokens_in'] += ti
            by_provider[p]['tokens_out'] += to_
            by_provider[p]['cost_usd'] = round(by_provider[p]['cost_usd'] + cost, 6)
            totals['cost_usd'] += cost

        totals['cost_usd'] = round(totals['cost_usd'], 6)
        return {'totals': totals, 'by_provider': by_provider}
    except Exception as e:
        return {'error': str(e), 'totals': None, 'by_provider': {}}


def _svc():
    return {'apikey': SUPABASE_SERVICE_KEY, 'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'}


@router.get('/costs')
async def cost_summary(admin: dict = Depends(require_super_admin)):
    tokens_dlp = 0
    if SUPABASE_SERVICE_KEY:
        try:
            async with httpx.AsyncClient(timeout=8.0) as c:
                r = await c.get(
                    f'{SUPABASE_URL}/rest/v1/user_dlp_stats?select=tokens_estimated',
                    headers=_svc(),
                )
                if r.is_success:
                    tokens_dlp = sum(x.get('tokens_estimated', 0) for x in r.json())
        except Exception:
            pass

    cf = await _fetch_cf_metrics()

    est_gemini = round(tokens_dlp / 1000 * COST_PER_1K['gemini'], 4)
    est_openai = round(tokens_dlp / 1000 * COST_PER_1K['openai'], 4)

    return {
        'tokens_estimated_total': tokens_dlp,
        'cost_breakdown': {'gemini_usd': est_gemini, 'openai_usd': est_openai},
        'cloudflare': cf,
        'note': 'Estimates based on DLP token counters. Actual costs visible in Cloudflare AI Gateway.',
    }
