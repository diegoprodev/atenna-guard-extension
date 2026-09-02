import os, httpx
from datetime import datetime, timezone

SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://kezbssjmgwtrunqeoyir.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')

async def record_audit_event(
    actor_id: str,
    action: str,
    target_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    correlation_id: str | None = None,
) -> None:
    row = {
        'actor_id': actor_id,
        'action': action,
        'target_id': target_id,
        'before': before,
        'after': after,
        'correlation_id': correlation_id,
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    print(f'[AUDIT] {action} by {actor_id} target={target_id}', flush=True)
    if not SUPABASE_SERVICE_KEY:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            await c.post(
                f'{SUPABASE_URL}/rest/v1/admin_audit_events',
                headers={
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
                    'Content-Type': 'application/json',
                },
                json=row,
            )
    except Exception:
        pass
