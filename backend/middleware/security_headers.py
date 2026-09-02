"""
HTTP Security Headers + request counter middleware.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from routes.metrics import counters


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"

        # Metrics counters
        status = response.status_code
        counters["requests_total"] += 1
        if 500 <= status < 600:
            counters["errors_5xx"] += 1
        elif 400 <= status < 500:
            counters["errors_4xx"] += 1
        if status in (401, 403):
            counters["auth_failures"] += 1

        return response
