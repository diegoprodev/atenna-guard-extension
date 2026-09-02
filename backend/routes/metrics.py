"""
Prometheus-compatible /metrics endpoint with in-memory counters.
Counters are incremented by SecurityHeadersMiddleware on each request.
"""
import time
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

router = APIRouter()

_start_time = time.time()

# Shared counters — incremented by middleware
counters = {
    "requests_total": 0,
    "errors_5xx": 0,
    "errors_4xx": 0,
    "auth_failures": 0,
}


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def metrics():
    uptime = time.time() - _start_time

    lines = [
        "# HELP atenna_uptime_seconds Time since last process start",
        "# TYPE atenna_uptime_seconds gauge",
        f"atenna_uptime_seconds {uptime:.1f}",
        "",
        "# HELP atenna_requests_total Total HTTP requests handled",
        "# TYPE atenna_requests_total counter",
        f"atenna_requests_total {counters['requests_total']}",
        "",
        "# HELP atenna_errors_5xx_total Server errors (5xx)",
        "# TYPE atenna_errors_5xx_total counter",
        f"atenna_errors_5xx_total {counters['errors_5xx']}",
        "",
        "# HELP atenna_errors_4xx_total Client errors (4xx)",
        "# TYPE atenna_errors_4xx_total counter",
        f"atenna_errors_4xx_total {counters['errors_4xx']}",
        "",
        "# HELP atenna_auth_failures_total JWT auth failures (401/403)",
        "# TYPE atenna_auth_failures_total counter",
        f"atenna_auth_failures_total {counters['auth_failures']}",
    ]
    return "\n".join(lines) + "\n"
