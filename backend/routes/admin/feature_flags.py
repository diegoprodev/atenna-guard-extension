import os, httpx, uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from middleware.admin_auth import require_super_admin
from services.audit_service import record_audit_event

router = APIRouter()

SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')

def _svc():
    return {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
    }

KNOWN_FLAGS = {'MULTIMODAL_ENABLED','DOCUMENT_DLP_ENABLED','STRICT_DOCUMENT_MODE',
               'DOCUMENT_UPLOAD_ENABLED','STRICT_DLP_MODE'}

class FlagUpdate(BaseModel):
    enabled: bool
    confirmed: bool = False

@router.get('/feature-flags')
async def get_flags(admin: dict = Depends(require_super_admin)):
    if not SUPABASE_SERVICE_KEY:
        return {'data': [], 'error': 'service_key_not_configured'}
    async with httpx.AsyncClient(timeout=8.0) as c:
        r = await c.get(
            f'{SUPABASE_URL}/rest/v1/admin_feature_flags?select=*&order=name.asc',
            headers=_svc(),
        )
    return {'data': r.json() if r.is_success else []}

@router.put('/feature-flags/{name}')
async def update_flag(name: str, body: FlagUpdate, admin: dict = Depends(require_super_admin)):
    if name not in KNOWN_FLAGS:
        raise HTTPException(400, f'Flag desconhecida: {name}')
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária. Envie confirmed=true.')
    if not SUPABASE_SERVICE_KEY:
        return {'error': 'service_key_not_configured'}
    corr = str(uuid.uuid4())
    async with httpx.AsyncClient(timeout=8.0) as c:
        # get before
        r_before = await c.get(
            f'{SUPABASE_URL}/rest/v1/admin_feature_flags?name=eq.{name}&select=*',
            headers=_svc(),
        )
        before_rows = r_before.json() if r_before.is_success else []
        before = before_rows[0] if before_rows else {}
        # update
        await c.patch(
            f'{SUPABASE_URL}/rest/v1/admin_feature_flags?name=eq.{name}',
            headers={**_svc(), 'Prefer': 'return=minimal'},
            json={'enabled': body.enabled, 'updated_by': admin.get('id'), 'updated_at': 'now()'},
        )
    await record_audit_event(
        admin.get('id', 'unknown'), f'feature_flag.{name}.set',
        name, before, {'enabled': body.enabled}, corr,
    )
    return {'ok': True, 'name': name, 'enabled': body.enabled, 'correlation_id': corr}
