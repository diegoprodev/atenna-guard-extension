import os, time, asyncio
from fastapi import APIRouter, Depends
import httpx

from middleware.admin_auth import require_super_admin

router = APIRouter()
_start_time = time.time()

def _read_proc(path: str) -> str:
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        return ''

def _mem_info() -> dict:
    lines = _read_proc('/proc/meminfo').splitlines()
    d = {}
    for line in lines:
        if ':' in line:
            k, v = line.split(':', 1)
            d[k.strip()] = int(v.strip().split()[0]) if v.strip() else 0
    total = d.get('MemTotal', 0)
    avail = d.get('MemAvailable', 0)
    used = total - avail
    return {'total_mb': total // 1024, 'used_mb': used // 1024, 'free_mb': avail // 1024}

def _disk_info() -> dict:
    try:
        import shutil
        usage = shutil.disk_usage('/')
        pct = round(usage.used / usage.total * 100, 1)
        return {'total_gb': round(usage.total / 1e9, 1), 'used_pct': pct}
    except Exception:
        return {'total_gb': 0, 'used_pct': 0}

@router.get('/system')
async def system_info(admin: dict = Depends(require_super_admin)):
    uptime_s = int(time.time() - _start_time)
    mem = _mem_info()
    disk = _disk_info()

    # Measure /health latency
    health_latency_ms = None
    try:
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=3.0) as c:
            await c.get('http://localhost:8000/health')
        health_latency_ms = round((time.monotonic() - t0) * 1000)
    except Exception:
        pass

    return {
        'uptime_seconds': uptime_s,
        'health_latency_ms': health_latency_ms,
        'memory': mem,
        'disk': disk,
        'container_status': 'running',
        'backend_status': 'ok',
    }
