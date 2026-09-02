"""
Métricas Prometheus custom (de negócio).

As métricas HTTP genéricas (latência por rota/método/status, contagem, in-progress)
vêm do `prometheus-fastapi-instrumentator`, ligado em `main.py`. Aqui ficam só as
métricas que o instrumentator não tem como saber: DLP, cota, provider de geração,
checkout, store de sessão.

Regra: **métrica nunca quebra o fluxo**. Import guardado + cada helper é best-effort.
O `/metrics` fica só na rede docker (o nginx bloqueia no domínio público).
"""
from __future__ import annotations

import logging

_log = logging.getLogger("atenna.metrics")

try:
    from prometheus_client import Counter, Gauge

    _ENABLED = True
except Exception:  # pragma: no cover - prometheus_client ausente = no-op
    _ENABLED = False


if _ENABLED:
    dlp_scans_total = Counter(
        "atenna_dlp_scans_total",
        "Revalidações de DLP server-side, por nível de risco apurado",
        ["risk_level"],
    )
    dlp_divergence_total = Counter(
        "atenna_dlp_client_server_divergence_total",
        "Cliente reportou risco menor do que o servidor apurou (possível bypass do DLP local)",
    )
    dlp_strict_rewrites_total = Counter(
        "atenna_dlp_strict_rewrites_total",
        "Prompts em que o STRICT_DLP_MODE reescreveu PII antes de chamar o LLM",
    )
    quota_blocks_total = Counter(
        "atenna_quota_blocks_total",
        "Requisições barradas por cota (HTTP 429), por plano",
        ["plan"],
    )
    generate_prompts_total = Counter(
        "atenna_generate_prompts_total",
        "Gerações de prompt, por provider e desfecho",
        ["provider", "outcome"],  # provider: openai|gemini|none ; outcome: ok|error|fallback
    )
    checkout_events_total = Counter(
        "atenna_checkout_events_total",
        "Eventos de checkout recebidos por webhook, por tipo",
        ["type"],
    )
    auth_failures_total = Counter(
        "atenna_auth_failures_total",
        "Falhas de autenticação no BFF, por motivo",
        ["reason"],  # raw_jwt | expired | no_session | malformed
    )
    bff_session_store = Gauge(
        "atenna_bff_session_store",
        "1 = sessões BFF persistidas no Postgres; 0 = fallback in-memory (perde durabilidade)",
    )
    bff_session_store.set(1)

else:

    class _NoopMetric:
        def labels(self, *_a, **_k):
            return self

        def inc(self, *_a, **_k):
            return None

        def set(self, *_a, **_k):
            return None

    dlp_scans_total = _NoopMetric()
    dlp_divergence_total = _NoopMetric()
    dlp_strict_rewrites_total = _NoopMetric()
    quota_blocks_total = _NoopMetric()
    generate_prompts_total = _NoopMetric()
    checkout_events_total = _NoopMetric()
    auth_failures_total = _NoopMetric()
    bff_session_store = _NoopMetric()


# ── Helpers best-effort ─────────────────────────────────────────────────────

def record_dlp_scan(risk_level: str) -> None:
    try:
        dlp_scans_total.labels(risk_level=(risk_level or "UNKNOWN")).inc()
    except Exception:  # pragma: no cover
        _log.debug("record_dlp_scan falhou", exc_info=True)


def record_dlp_divergence() -> None:
    try:
        dlp_divergence_total.inc()
    except Exception:  # pragma: no cover
        _log.debug("record_dlp_divergence falhou", exc_info=True)


def record_strict_rewrite() -> None:
    try:
        dlp_strict_rewrites_total.inc()
    except Exception:  # pragma: no cover
        _log.debug("record_strict_rewrite falhou", exc_info=True)


def record_quota_block(plan: str) -> None:
    try:
        quota_blocks_total.labels(plan=(plan or "free")).inc()
    except Exception:  # pragma: no cover
        _log.debug("record_quota_block falhou", exc_info=True)


def record_generation(provider: str, outcome: str) -> None:
    try:
        generate_prompts_total.labels(provider=provider, outcome=outcome).inc()
    except Exception:  # pragma: no cover
        _log.debug("record_generation falhou", exc_info=True)


def record_checkout_event(event_type: str) -> None:
    try:
        checkout_events_total.labels(type=(event_type or "unknown")).inc()
    except Exception:  # pragma: no cover
        _log.debug("record_checkout_event falhou", exc_info=True)


def record_auth_failure(reason: str) -> None:
    try:
        auth_failures_total.labels(reason=(reason or "unknown")).inc()
    except Exception:  # pragma: no cover
        _log.debug("record_auth_failure falhou", exc_info=True)


def set_bff_session_store(healthy: bool) -> None:
    try:
        bff_session_store.set(1 if healthy else 0)
    except Exception:  # pragma: no cover
        _log.debug("set_bff_session_store falhou", exc_info=True)
