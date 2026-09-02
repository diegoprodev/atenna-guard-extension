import os, httpx
from fastapi import APIRouter, Depends
from middleware.admin_auth import require_super_admin

router = APIRouter()
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')

def _svc():
    return {'apikey': SUPABASE_SERVICE_KEY, 'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'}

@router.get('/dlp')
async def dlp_stats(admin: dict = Depends(require_super_admin)):
    if not SUPABASE_SERVICE_KEY:
        return {'error': 'service_key_not_configured', 'aggregate': {}}
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(
                f'{SUPABASE_URL}/rest/v1/user_dlp_stats?select=scans_total,protected_count,tokens_estimated',
                headers=_svc(),
            )
        rows = r.json() if r.is_success else []
        return {
            'aggregate': {
                'scans_total': sum(x.get('scans_total', 0) for x in rows),
                'protected_count': sum(x.get('protected_count', 0) for x in rows),
                'tokens_estimated': sum(x.get('tokens_estimated', 0) for x in rows),
                'users_with_data': len(rows),
            },
        }
    except Exception:
        return {'error': 'unavailable', 'aggregate': {}}
