import os, httpx, uuid
from fastapi import APIRouter, Depends, HTTPException, Query
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

def _no_key():
    return not bool(SUPABASE_SERVICE_KEY)

def _safe_user(u: dict, profile: dict | None = None) -> dict:
    """Strip sensitive fields — never return tokens or hashed passwords."""
    plan = (profile or {}).get("plan") or u.get("user_metadata", {}).get("plan_type", "free") or "free"
    return {
        'id':              u.get('id'),
        'email':           u.get('email'),
        'created_at':      u.get('created_at'),
        'last_sign_in_at': u.get('last_sign_in_at'),
        'banned_until':    u.get('banned_until'),
        'role':            u.get('app_metadata', {}).get('role'),
        'plan_type':       plan,
        'display_name':    (profile or {}).get('display_name'),
        'plan_expires_at': (profile or {}).get('plan_expires_at'),
    }

class ConfirmAction(BaseModel):
    confirmed: bool = False
    reason: str = ''

class PlanUpdate(BaseModel):
    plan_type: str
    confirmed: bool = False

@router.get('/users')
async def list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    search: str = Query('', max_length=100),
    admin: dict = Depends(require_super_admin),
):
    if _no_key():
        return {'error': 'service_key_not_configured', 'data': [], 'total': 0}
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(
                f'{SUPABASE_URL}/auth/v1/admin/users',
                headers=_svc(),
                params={'page': page, 'per_page': limit},
            )
            if not r.is_success:
                raise HTTPException(502, 'Supabase unavailable')
            body  = r.json()
            users = body.get('users', [])
            total = body.get('total', len(users))

            # Client-side search (Supabase admin API nao suporta search)
            if search:
                sl = search.lower()
                users = [u for u in users if sl in (u.get('email') or '').lower()
                         or sl in (u.get('user_metadata', {}).get('display_name') or '').lower()]

            # Enrich with profiles (fonte de verdade para plan + display_name)
            profiles_map: dict = {}
            if users:
                try:
                    ids_csv = ','.join(u['id'] for u in users if u.get('id'))
                    rp = await c.get(
                        f'{SUPABASE_URL}/rest/v1/profiles'
                        f'?id=in.({ids_csv})'
                        f'&select=id,plan,plan_type,plan_expires_at,display_name',
                        headers=_svc(),
                    )
                    if rp.is_success:
                        for p in rp.json():
                            profiles_map[p['id']] = p
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f'profiles enrichment failed: {e}')

        return {'data': [_safe_user(u, profiles_map.get(u.get('id'))) for u in users], 'total': total, 'page': page}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, 'Supabase unavailable')


@router.get('/users/lookup')
async def lookup_user_by_email(
    email: str = Query(..., min_length=3),
    admin: dict = Depends(require_super_admin),
):
    """Busca usuario por email parcial — para preencher user_id no assign plan."""
    if _no_key():
        raise HTTPException(503, 'service_key_not_configured')
    async with httpx.AsyncClient(timeout=8.0) as c:
        r = await c.get(
            f'{SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=100',
            headers=_svc(),
        )
        rp = await c.get(
            f'{SUPABASE_URL}/rest/v1/profiles?select=id,email,plan,display_name',
            headers=_svc(),
        )
    if not r.is_success:
        raise HTTPException(502, 'Supabase unavailable')

    users = r.json().get('users', [])
    profiles = {p['id']: p for p in (rp.json() if rp.is_success else [])}

    el = email.lower()
    results = []
    for u in users:
        ue = (u.get('email') or '').lower()
        profile = profiles.get(u.get('id', ''), {})
        dn = (profile.get('display_name') or '').lower()
        if el in ue or el in dn:
            results.append({
                'id':           u.get('id'),
                'email':        u.get('email'),
                'display_name': profile.get('display_name'),
                'plan':         profile.get('plan', 'free'),
            })
    return {'data': results[:10]}

@router.get('/users/{user_id}')
async def get_user(user_id: str, admin: dict = Depends(require_super_admin)):
    if _no_key():
        return {'error': 'service_key_not_configured'}
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}', headers=_svc())
        if r.status_code == 404:
            raise HTTPException(404, 'Usuário não encontrado.')
        if not r.is_success:
            raise HTTPException(502, 'Supabase unavailable')
        return _safe_user(r.json())
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, 'Supabase unavailable')

@router.post('/users/{user_id}/block')
async def block_user(user_id: str, body: ConfirmAction, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária.')
    if _no_key():
        return {'error': 'service_key_not_configured'}
    corr = str(uuid.uuid4())
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            await c.put(
                f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}',
                headers=_svc(),
                json={'ban_duration': '876600h'},
            )
        await record_audit_event(admin['id'], 'user.block', user_id, None, {'banned': True}, corr)
        return {'ok': True, 'correlation_id': corr}
    except Exception:
        raise HTTPException(502, 'Supabase unavailable')

@router.post('/users/{user_id}/revoke-session')
async def revoke_session(user_id: str, body: ConfirmAction, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária.')
    if _no_key():
        return {'error': 'service_key_not_configured'}
    corr = str(uuid.uuid4())
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            await c.post(
                f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}/logout',
                headers=_svc(),
                json={'scope': 'global'},
            )
        await record_audit_event(admin['id'], 'user.revoke_session', user_id, None, None, corr)
        return {'ok': True, 'correlation_id': corr}
    except Exception:
        raise HTTPException(502, 'Supabase unavailable')

@router.post('/users/{user_id}/reset-quota')
async def reset_quota(user_id: str, body: ConfirmAction, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária.')
    if _no_key():
        return {'error': 'service_key_not_configured'}
    corr = str(uuid.uuid4())
    await record_audit_event(admin['id'], 'user.reset_quota', user_id, None, {'reset': True}, corr)
    return {'ok': True, 'correlation_id': corr, 'note': 'quota_key_reset_in_client_storage'}

@router.put('/users/{user_id}/plan')
async def update_plan(user_id: str, body: PlanUpdate, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária.')
    if body.plan_type not in ('free', 'pro', 'enterprise'):
        raise HTTPException(400, 'Plano inválido.')
    if _no_key():
        return {'error': 'service_key_not_configured'}
    corr = str(uuid.uuid4())
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            # Update via user_plans table (upsert)
            await c.post(
                f'{SUPABASE_URL}/rest/v1/user_plans',
                headers={**_svc(), 'Prefer': 'resolution=merge-duplicates'},
                json={'user_id': user_id, 'plan_type': body.plan_type},
            )
        await record_audit_event(admin['id'], 'user.plan_change', user_id, None, {'plan_type': body.plan_type}, corr)
        return {'ok': True, 'correlation_id': corr}
    except Exception:
        raise HTTPException(502, 'Supabase unavailable')

class PasswordReset(BaseModel):
    password: str
    confirmed: bool = False

@router.post('/users/{user_id}/set-password')
async def set_password(user_id: str, body: PasswordReset, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmacao necessaria.')
    if _no_key():
        return {'error': 'service_key_not_configured'}

    from utils.password_policy import validate_admin_password
    violations = validate_admin_password(body.password)
    if violations:
        raise HTTPException(422, {'violations': violations})

    corr = str(uuid.uuid4())
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.put(
                f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}',
                headers=_svc(),
                json={'password': body.password},
            )
        if not r.is_success:
            raise HTTPException(502, 'Supabase unavailable')
        await record_audit_event(admin['id'], 'user.password_reset', user_id, None, {'by_admin': admin['id']}, corr)
        return {'ok': True, 'correlation_id': corr}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, 'Supabase unavailable')

# ── CRUD completo ──────────────────────────────────────────────

class CreateUser(BaseModel):
    email: str
    password: str = ''
    role: str = ''
    plan_type: str = 'free'
    send_invite: bool = False

class EditUser(BaseModel):
    email: str = ''
    role: str = ''
    plan_type: str = ''
    confirmed: bool = False

class DeleteUser(BaseModel):
    confirmed: bool = False

@router.post('/users')
async def create_user(body: CreateUser, admin: dict = Depends(require_super_admin)):
    if _no_key():
        raise HTTPException(503, 'service_key_not_configured')

    from utils.password_policy import validate_admin_password
    if body.password:
        violations = validate_admin_password(body.password)
        if violations:
            raise HTTPException(422, {'violations': violations})

    corr = str(uuid.uuid4())
    payload: dict = {'email': body.email, 'email_confirm': True}
    if body.password:
        payload['password'] = body.password
    if body.role:
        payload['app_metadata'] = {'role': body.role}

    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.post(
                f'{SUPABASE_URL}/auth/v1/admin/users',
                headers=_svc(),
                json=payload,
            )
        if not r.is_success:
            detail = r.json().get('msg', r.text)
            raise HTTPException(400, detail)
        user = r.json()
        uid = user['id']

        # Set plan
        if body.plan_type and body.plan_type != 'free':
            async with httpx.AsyncClient(timeout=8.0) as c:
                await c.post(
                    f'{SUPABASE_URL}/rest/v1/user_plans',
                    headers={**_svc(), 'Prefer': 'resolution=merge-duplicates'},
                    json={'user_id': uid, 'plan_type': body.plan_type},
                )

        # Send magic link if requested
        if body.send_invite:
            async with httpx.AsyncClient(timeout=8.0) as c:
                await c.post(
                    f'{SUPABASE_URL}/auth/v1/admin/users/{uid}/reauthenticate',
                    headers=_svc(),
                )

        await record_audit_event(admin['id'], 'user.create', uid,
                                 None, {'email': body.email, 'role': body.role, 'plan': body.plan_type}, corr)
        return {'ok': True, 'user': _safe_user(user), 'correlation_id': corr}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


@router.post('/users/{user_id}/send-link')
async def send_magic_link(user_id: str, admin: dict = Depends(require_super_admin)):
    """Send password reset email to user."""
    if _no_key():
        raise HTTPException(503, 'service_key_not_configured')
    corr = str(uuid.uuid4())
    try:
        # Fetch user email first
        async with httpx.AsyncClient(timeout=8.0) as c:
            ur = await c.get(f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}', headers=_svc())
        if not ur.is_success:
            raise HTTPException(404, 'Usuário não encontrado.')
        email = ur.json().get('email', '')

        # Generate recovery link via admin API
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.post(
                f'{SUPABASE_URL}/auth/v1/admin/generate_link',
                headers=_svc(),
                json={'type': 'recovery', 'email': email},
            )
        if not r.is_success:
            raise HTTPException(502, r.json().get('msg', 'Erro ao gerar link.'))

        await record_audit_event(admin['id'], 'user.send_link', user_id, None,
                                 {'email': email, 'type': 'recovery'}, corr)
        return {'ok': True, 'correlation_id': corr}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


@router.put('/users/{user_id}')
async def edit_user(user_id: str, body: EditUser, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária.')
    if _no_key():
        raise HTTPException(503, 'service_key_not_configured')
    corr = str(uuid.uuid4())

    try:
        # Fetch before state
        async with httpx.AsyncClient(timeout=8.0) as c:
            ur = await c.get(f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}', headers=_svc())
        before = _safe_user(ur.json()) if ur.is_success else {}

        patch: dict = {}
        if body.email:
            patch['email'] = body.email
        if body.role is not None and body.role != '':
            patch['app_metadata'] = {'role': body.role}

        if patch:
            async with httpx.AsyncClient(timeout=8.0) as c:
                r = await c.put(
                    f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}',
                    headers=_svc(),
                    json=patch,
                )
            if not r.is_success:
                raise HTTPException(400, r.json().get('msg', 'Erro ao editar.'))

        if body.plan_type:
            async with httpx.AsyncClient(timeout=8.0) as c:
                await c.post(
                    f'{SUPABASE_URL}/rest/v1/user_plans',
                    headers={**_svc(), 'Prefer': 'resolution=merge-duplicates'},
                    json={'user_id': user_id, 'plan_type': body.plan_type},
                )

        after = {**before, 'email': body.email or before.get('email'),
                 'role': body.role or before.get('role'),
                 'plan_type': body.plan_type or before.get('plan_type')}
        await record_audit_event(admin['id'], 'user.edit', user_id, before, after, corr)
        return {'ok': True, 'correlation_id': corr}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


@router.delete('/users/{user_id}')
async def delete_user(user_id: str, body: DeleteUser, admin: dict = Depends(require_super_admin)):
    if not body.confirmed:
        raise HTTPException(400, 'Confirmação necessária.')
    if _no_key():
        raise HTTPException(503, 'service_key_not_configured')
    # Prevent self-deletion
    if user_id == admin.get('id'):
        raise HTTPException(400, 'Não é possível excluir sua própria conta.')
    corr = str(uuid.uuid4())
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            ur = await c.get(f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}', headers=_svc())
        before = _safe_user(ur.json()) if ur.is_success else {'id': user_id}

        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.delete(f'{SUPABASE_URL}/auth/v1/admin/users/{user_id}', headers=_svc())
        if not r.is_success:
            raise HTTPException(400, r.json().get('msg', 'Erro ao excluir.'))

        await record_audit_event(admin['id'], 'user.delete', user_id, before, None, corr)
        return {'ok': True, 'correlation_id': corr}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))
