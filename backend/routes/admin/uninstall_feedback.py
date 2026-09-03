import os, httpx
from fastapi import APIRouter, Depends, Query
from middleware.admin_auth import require_super_admin

router = APIRouter()
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')


def _svc():
    return {'apikey': SUPABASE_SERVICE_KEY, 'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'}


@router.get('/uninstall-feedback')
async def list_uninstall_feedback(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_super_admin),
):
    """Respostas do formulário mostrado ao desinstalar a extensão (FASE 10.6)."""
    if not SUPABASE_SERVICE_KEY:
        return {'data': [], 'total': 0, 'error': 'service_key_not_configured'}
    offset = (page - 1) * limit
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(
                f'{SUPABASE_URL}/rest/v1/uninstall_feedback'
                f'?select=id,reason,detail,email,ext_version,created_at'
                f'&order=created_at.desc&limit={limit}&offset={offset}',
                headers={**_svc(), 'Prefer': 'count=exact'},
            )
        total = int(r.headers.get('content-range', '0/0').split('/')[-1] or 0)
        return {'data': r.json() if r.is_success else [], 'total': total}
    except Exception:
        return {'data': [], 'total': 0, 'error': 'unavailable'}


@router.get('/uninstall-feedback/summary')
async def uninstall_feedback_summary(admin: dict = Depends(require_super_admin)):
    """Contagem por motivo — pra ver rápido o que mais dói."""
    if not SUPABASE_SERVICE_KEY:
        return {'by_reason': {}, 'total': 0}
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(
                f'{SUPABASE_URL}/rest/v1/uninstall_feedback?select=reason&limit=5000',
                headers=_svc(),
            )
        rows = r.json() if r.is_success else []
        by_reason: dict[str, int] = {}
        for row in rows:
            k = row.get('reason', 'desconhecido')
            by_reason[k] = by_reason.get(k, 0) + 1
        return {'by_reason': dict(sorted(by_reason.items(), key=lambda x: -x[1])), 'total': len(rows)}
    except Exception:
        return {'by_reason': {}, 'total': 0}
