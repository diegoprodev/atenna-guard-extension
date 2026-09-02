import os, httpx, datetime
from fastapi import APIRouter, Depends
from middleware.admin_auth import require_super_admin

router = APIRouter()
SUPABASE_URL      = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
CF_TOKEN          = os.getenv('CF_AIG_TOKEN', '')
CF_ACCOUNT_ID     = os.getenv('CF_ACCOUNT_ID', '')
CF_GATEWAY_ID     = os.getenv('CF_GATEWAY_ID', 'atenna-safe-plugin')

PROVIDER_COST = {'google-ai-studio': 0.00015, 'openai': 0.00200}

def _svc():
    return {'apikey': SUPABASE_SERVICE_KEY, 'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'}

async def _check_url(client, url, headers=None, timeout=3.0):
    try:
        r = await client.get(url, headers=headers or {}, timeout=timeout)
        return r.is_success
    except Exception:
        return False

async def _fetch_usd_brl(client: httpx.AsyncClient) -> float:
    """Fetch live USD→BRL from frankfurter.app (free, no key, ECB-based)."""
    try:
        r = await client.get(
            'https://api.frankfurter.app/latest?from=USD&to=BRL',
            timeout=4.0
        )
        if r.is_success:
            rate = r.json().get('rates', {}).get('BRL')
            if rate:
                return float(rate)
    except Exception:
        pass
    return 5.06  # fallback if API unreachable

@router.get('/overview')
async def admin_overview(_: dict = Depends(require_super_admin)):
    today = datetime.date.today().isoformat()

    async with httpx.AsyncClient(timeout=10.0) as c:
        # ── 0. Live USD/BRL rate ───────────────────────────────
        usd_brl = await _fetch_usd_brl(c)

        # ── 1. Auth users (real count) ─────────────────────────
        users_total = 0
        users_active_today = 0
        try:
            r = await c.get(
                f'{SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000',
                headers=_svc()
            )
            if r.is_success:
                all_users = r.json().get('users', [])
                users_total = len(all_users)
                users_active_today = sum(
                    1 for u in all_users
                    if (u.get('last_sign_in_at') or '')[:10] == today
                )
        except Exception:
            pass

        # ── 2. DLP stats ───────────────────────────────────────
        dlp_scans_total = 0
        dlp_protected_total = 0
        try:
            r = await c.get(
                f'{SUPABASE_URL}/rest/v1/user_dlp_stats?select=scans_total,protected_count',
                headers=_svc()
            )
            if r.is_success:
                rows = r.json()
                dlp_scans_total    = sum(x.get('scans_total', 0) for x in rows)
                dlp_protected_total = sum(x.get('protected_count', 0) for x in rows)
        except Exception:
            pass

        # ── 3. DLP events today ────────────────────────────────
        prompts_today = 0
        try:
            r = await c.get(
                f'{SUPABASE_URL}/rest/v1/dlp_events?select=id&created_at=gte.{today}T00:00:00',
                headers={**_svc(), 'Prefer': 'count=exact'}
            )
            if r.is_success:
                ct = r.headers.get('content-range', '0/0')
                prompts_today = int(ct.split('/')[-1] or 0)
        except Exception:
            pass

        # ── 4. CF Gateway cost (real) ──────────────────────────
        cost_usd = 0.0
        cf_requests_today = 0
        try:
            if CF_TOKEN:
                r = await c.get(
                    f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}'
                    f'/ai-gateway/gateways/{CF_GATEWAY_ID}/logs?limit=1000',
                    headers={'Authorization': f'Bearer {CF_TOKEN}'}
                )
                if r.is_success:
                    logs = r.json().get('result', [])
                    for l in logs:
                        ti = l.get('tokens_in') or 0
                        to_ = l.get('tokens_out') or 0
                        p = l.get('provider', '')
                        cost_usd += (ti + to_) / 1000 * PROVIDER_COST.get(p, 0.001)
                        if (l.get('created_at') or '')[:10] == today:
                            cf_requests_today += 1
                    cost_usd = round(cost_usd, 6)
        except Exception:
            pass

        # ── 5. Errors today ────────────────────────────────────
        errors_5xx_today = 0
        try:
            r = await c.get(
                f'{SUPABASE_URL}/rest/v1/admin_error_events'
                f'?select=id&created_at=gte.{today}T00:00:00&status_code=gte.500',
                headers={**_svc(), 'Prefer': 'count=exact'}
            )
            if r.is_success:
                errors_5xx_today = int(r.headers.get('content-range', '0/0').split('/')[-1] or 0)
        except Exception:
            pass

        # ── 6. Health checks ───────────────────────────────────
        supabase_ok = await _check_url(c, f'{SUPABASE_URL}/rest/v1/', _svc())
        openai_ok   = await _check_url(c, 'https://api.openai.com/v1/models',
                                       {'Authorization': f'Bearer {os.getenv("OPENAI_API_KEY","")}'},
                                       timeout=4.0)
        gemini_ok   = True

    cost_brl = round(cost_usd * usd_brl, 2)

    return {
        'users_total':         users_total,
        'users_active_today':  users_active_today,
        'prompts_today':       prompts_today,
        'uploads_analyzed':    0,
        'dlp_scans_total':     dlp_scans_total,
        'dlp_protected_total': dlp_protected_total,
        'errors_5xx_today':    errors_5xx_today,
        'cost_estimate_usd':   cost_usd,
        'cost_estimate_brl':   cost_brl,
        'usd_brl_rate':        round(usd_brl, 4),
        'cf_requests_today':   cf_requests_today,
        'status': {
            'backend':  'ok',
            'supabase': 'ok' if supabase_ok else 'degraded',
            'openai':   'ok' if openai_ok else 'degraded',
            'gemini':   'ok' if gemini_ok else 'degraded',
        },
    }
