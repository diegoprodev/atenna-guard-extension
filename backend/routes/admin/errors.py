import os, httpx
from fastapi import APIRouter, Depends, Query
from middleware.admin_auth import require_super_admin

router = APIRouter()
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')

def _svc():
    return {'apikey': SUPABASE_SERVICE_KEY, 'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'}

@router.get('/errors')
async def get_errors(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_super_admin),
):
    if not SUPABASE_SERVICE_KEY:
        return {'data': [], 'error': 'service_key_not_configured'}
    offset = (page - 1) * limit
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(
                f'{SUPABASE_URL}/rest/v1/admin_error_events?select=id,status_code,endpoint,method,error_type,error_message,severity,created_at,correlation_id&order=created_at.desc&limit={limit}&offset={offset}',
                headers={**_svc(), 'Prefer': 'count=exact'},
            )
        total = int(r.headers.get('content-range', '0/0').split('/')[-1] or 0)
        return {'data': r.json() if r.is_success else [], 'total': total}
    except Exception:
        return {'data': [], 'error': 'unavailable'}
