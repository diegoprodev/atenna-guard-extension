"""
/metrics — formato de texto Prometheus.

**Interno.** O nginx bloqueia `/metrics` no domínio público
(`location = /metrics { return 404; }`); o Prometheus raspa pela rede docker
(`http://backend:8000/metrics`). Não há token porque a porta 8000 nunca sai
da rede docker.

As métricas HTTP (latência por rota, contagem, status) são registradas pelo
`prometheus-fastapi-instrumentator` em `main.py`. As de negócio ficam em
`observability_metrics.py`. Este módulo só expõe o registry.
"""
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

router = APIRouter()

try:
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

    _PROM = True
except Exception:  # pragma: no cover
    _PROM = False


@router.get("/metrics", include_in_schema=False)
async def metrics() -> PlainTextResponse:
    if not _PROM:
        return PlainTextResponse("# prometheus_client indisponivel\n", status_code=503)
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)
