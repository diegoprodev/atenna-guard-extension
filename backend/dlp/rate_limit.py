"""
Server-side rate limiting + audit logging via Supabase dlp_events table.

FREE:  5/day, 25/month
PRO:  20/hour, 60/day, 150/week, 300/month
"""
from __future__ import annotations
import os, logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from supabase import create_client, Client

logger = logging.getLogger(__name__)

FREE_DAILY_LIMIT   = 5
FREE_MONTHLY_LIMIT = 25
PRO_HOURLY_LIMIT   = 20
PRO_DAILY_LIMIT    = 60
PRO_WEEKLY_LIMIT   = 150
PRO_MONTHLY_LIMIT  = 300

_sb: Optional[Client] = None

def _get_client() -> Optional[Client]:
    global _sb
    if _sb is None:
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY')
        if url and key:
            try:
                _sb = create_client(url, key)
            except Exception as e:
                logger.warning(f'rate_limit: Supabase init failed: {e}')
    return _sb

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _window_start(window: str) -> str:
    now = _now_utc()
    if window == 'hour':
        start = now.replace(minute=0, second=0, microsecond=0)
    elif window == 'day':
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif window == 'week':
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif window == 'month':
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        raise ValueError(f'Unknown window: {window}')
    return start.isoformat()

def _next_window_reset(window: str) -> str:
    now = _now_utc()
    if window == 'hour':
        reset = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    elif window == 'day':
        reset = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    elif window == 'week':
        reset = (now + timedelta(days=(7 - now.weekday()))).replace(hour=0, minute=0, second=0, microsecond=0)
    elif window == 'month':
        if now.month == 12:
            reset = now.replace(year=now.year+1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            reset = now.replace(month=now.month+1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        reset = now + timedelta(hours=1)
    return reset.isoformat()

def get_user_plan(user_id: str) -> str:
    sb = _get_client()
    if not sb:
        return 'free'
    try:
        resp = sb.table('user_plans').select('plan_type, status').eq('user_id', user_id).maybe_single().execute()
        if resp and resp.data:
            plan   = resp.data.get('plan_type', 'free') or 'free'
            status = resp.data.get('status', 'active') or 'active'
            if plan == 'pro' and status not in ('canceled', 'expired'):
                return 'pro'
    except Exception as e:
        logger.warning(f'rate_limit: user_plans query error: {e}')
    try:
        resp = sb.table('profiles').select('plan, plan_expires_at').eq('id', user_id).maybe_single().execute()
        if resp and resp.data:
            plan       = resp.data.get('plan', 'free') or 'free'
            expires_at = resp.data.get('plan_expires_at')
            if plan == 'pro':
                if expires_at:
                    exp_dt = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                    if exp_dt > _now_utc():
                        return 'pro'
                else:
                    return 'pro'
    except Exception as e:
        logger.warning(f'rate_limit: profiles fallback error: {e}')
    return 'free'

def _count_window(user_id: str, window: str) -> int:
    sb = _get_client()
    if not sb:
        return 0
    try:
        start = _window_start(window)
        resp = (
            sb.table('dlp_events')
            .select('id', count='exact')
            .eq('user_id', user_id)
            .eq('event_type', 'generate_prompt')
            .gte('created_at', start)
            .execute()
        )
        return resp.count or 0
    except Exception as e:
        logger.warning(f'rate_limit: count_{window} error: {e}')
        return 0

def check_rate_limit(user_id: str, plan: str) -> dict:
    """Check all applicable rate limit windows. Returns first window exceeded."""
    if plan == 'pro':
        checks = [
            ('hour',  PRO_HOURLY_LIMIT),
            ('day',   PRO_DAILY_LIMIT),
            ('week',  PRO_WEEKLY_LIMIT),
            ('month', PRO_MONTHLY_LIMIT),
        ]
    else:
        checks = [
            ('day',   FREE_DAILY_LIMIT),
            ('month', FREE_MONTHLY_LIMIT),
        ]

    for window, limit in checks:
        count = _count_window(user_id, window)
        if count >= limit:
            return {
                'allowed':  False,
                'count':    count,
                'limit':    limit,
                'window':   window,
                'reset_at': _next_window_reset(window),
            }

    day_count = _count_window(user_id, 'day')
    day_limit = PRO_DAILY_LIMIT if plan == 'pro' else FREE_DAILY_LIMIT
    return {
        'allowed':  True,
        'count':    day_count,
        'limit':    day_limit,
        'window':   'day',
        'reset_at': _next_window_reset('day'),
    }


def audit_log(
    user_id: str,
    action: str,
    *,
    risk_level: str = 'NONE',
    entity_types: list = None,
    entity_count: int = 0,
    was_rewritten: bool = False,
    user_override: bool = False,
    quota_count: Optional[int] = None,
    session_id: Optional[str] = None,
    metadata: dict = None,
    duration_ms: int = 0,
) -> None:
    """Write audit event to dlp_events. Non-blocking."""
    sb = _get_client()
    if not sb:
        return
    record = {
        'user_id':          user_id,
        'event_type':       action,
        'risk_level':       risk_level,
        'entity_types':     entity_types or [],
        'entity_count':     entity_count,
        'was_rewritten':    was_rewritten,
        'strict_mode':      False,
        'had_mismatch':     False,
        'timeout_occurred': False,
        'error_occurred':   False,
        'duration_ms':      duration_ms,
        'session_id':       session_id,
        'metadata':         metadata or {},
    }
    if quota_count is not None:
        record['metadata']['quota_count'] = quota_count
    try:
        sb.table('dlp_events').insert(record).execute()
    except Exception as e:
        logger.warning(f'rate_limit: audit_log insert error: {e}')
