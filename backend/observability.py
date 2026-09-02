"""
Observabilidade — GlitchTip (Sentry-compatível).

Objetivo: saber de TODO erro antes do usuário, com contexto estruturado
(o quê, como, quem, onde, quando) e SEM vazar PII para o painel.

Ligado só se GLITCHTIP_DSN estiver no ambiente. Sem DSN = no-op.
"""
from __future__ import annotations

import os
import re

_DSN = os.getenv("GLITCHTIP_DSN") or os.getenv("SENTRY_DSN") or ""
_ENV = os.getenv("ATENNA_ENV", "production")
_RELEASE = os.getenv("GIT_SHA") or os.getenv("RELEASE") or "dev"

_enabled = False

# ── Scrubbing de PII antes de enviar para o painel ──────────────────────────
_CPF   = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_CNPJ  = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_CARD  = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+")
_JWT   = re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b")
_KEY   = re.compile(r"\b(?:sk-[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{10,}|re_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{35})\b")

_SENSITIVE_KEYS = {
    "authorization", "cookie", "set-cookie", "x-api-key", "apikey", "api_key",
    "password", "token", "access_token", "refresh_token", "supabase_jwt",
    "asaas-access-token", "resend_api_key", "service_role_key", "secret",
}


def _scrub_text(s: str) -> str:
    for rx, tok in (
        (_JWT, "[JWT]"), (_KEY, "[KEY]"), (_BEARER, "Bearer [TOKEN]"),
        (_CPF, "[CPF]"), (_CNPJ, "[CNPJ]"), (_CARD, "[CARD]"), (_EMAIL, "[EMAIL]"),
    ):
        s = rx.sub(tok, s)
    return s


def _scrub(obj):
    if isinstance(obj, str):
        return _scrub_text(obj)
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if str(k).lower() in _SENSITIVE_KEYS:
                out[k] = "[Filtered]"
            else:
                out[k] = _scrub(v)
        return out
    if isinstance(obj, (list, tuple)):
        return type(obj)(_scrub(v) for v in obj)
    return obj


def _before_send(event, hint):
    try:
        # request body / headers / query / cookies
        req = event.get("request")
        if req:
            for f in ("data", "headers", "query_string", "cookies", "env"):
                if f in req:
                    req[f] = _scrub(req[f])
        # breadcrumbs
        for bc in event.get("breadcrumbs", {}).get("values", []) or []:
            if "message" in bc:
                bc["message"] = _scrub_text(str(bc["message"]))
            if "data" in bc:
                bc["data"] = _scrub(bc["data"])
        # exception values / logentry
        for exc in event.get("exception", {}).get("values", []) or []:
            if exc.get("value"):
                exc["value"] = _scrub_text(exc["value"])
        le = event.get("logentry")
        if le and le.get("message"):
            le["message"] = _scrub_text(le["message"])
        # extra / contexts
        if "extra" in event:
            event["extra"] = _scrub(event["extra"])
    except Exception:
        pass
    return event


def init() -> bool:
    """Inicializa o SDK. Retorna True se ativo."""
    global _enabled
    if not _DSN or _enabled:
        return _enabled
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
        from sentry_sdk.integrations.asyncio import AsyncioIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration

        sentry_sdk.init(
            dsn=_DSN,
            environment=_ENV,
            release=_RELEASE,
            send_default_pii=False,
            max_request_body_size="small",
            attach_stacktrace=True,
            traces_sample_rate=0.0,  # GlitchTip: foco em erros; perf desligada
            integrations=[
                StarletteIntegration(), FastApiIntegration(), AsyncioIntegration(),
                LoggingIntegration(level=None, event_level="ERROR"),
            ],
            before_send=_before_send,
        )
        _enabled = True
    except Exception:
        _enabled = False
    return _enabled


def set_request_user(user_id: str | None, email: str | None = None, plan: str | None = None) -> None:
    """Chamar em require_auth — anexa quem à issue (id só, email é hasheado pelo GlitchTip)."""
    if not _enabled:
        return
    try:
        import sentry_sdk
        data = {}
        if user_id:
            data["id"] = user_id
        if plan:
            sentry_sdk.set_tag("plan", plan)
        if data:
            sentry_sdk.set_user(data)
    except Exception:
        pass


def monitor(monitor_slug: str):
    """Decorator p/ jobs do scheduler — GlitchTip alerta se o job não rodar / falhar."""
    def deco(fn):
        if not _enabled:
            return fn
        try:
            import sentry_sdk.crons
            return sentry_sdk.crons.monitor(monitor_slug=monitor_slug)(fn)
        except Exception:
            return fn
    return deco
