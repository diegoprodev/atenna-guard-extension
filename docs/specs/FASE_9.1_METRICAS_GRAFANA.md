# FASE 9.1 — Métricas (Prometheus) + Grafana + alerta de degradação

**Status:** em implementação · **Depende de:** FASE 9.0 (backend no repo), P5 GlitchTip
**Não bloqueia:** republicação da extensão na Chrome Web Store.

## Problema

O `/metrics` que existe hoje (`backend/routes/metrics.py`) tem 3 defeitos:

1. **Exposto publicamente** — `GET https://api.atennaia.com.br/metrics` responde 200 sem
   autenticação. Vaza volume de tráfego, taxa de erro e nº de falhas de auth para qualquer um.
2. **Contadores in-memory sem dimensão** — 4 números globais que zeram a cada restart. Sem
   latência, sem percentis, sem quebra por rota/status, sem métricas de negócio (DLP, cota,
   checkout).
3. **Ninguém olha** — não há coletor nem painel nem alerta. O objetivo do dono ("saber da
   degradação antes do usuário") não é atendido só com erro-tracking (GlitchTip pega exceção,
   não pega "o `/generate-prompts` está lento" ou "os 5xx subiram para 3%").

## Objetivo

Painel em tempo real + alerta automático no Discord quando o serviço **degrada** (não só
quando quebra). Enterprise-grade, self-hosted, sem custo novo.

## Decisões

| Tema | Decisão | Porquê |
|---|---|---|
| Instrumentação | `prometheus-fastapi-instrumentator` + `prometheus_client` | histogramas de latência por rota/método/status prontos; +métricas custom de negócio. Substitui o contador manual. |
| Exposição do `/metrics` | **bloqueado no nginx** (`location = /metrics { return 404; }`). Prometheus raspa `http://backend:8000/metrics` **pela rede docker** `atenna-backend_atenna`. | zero-trust: métrica interna não é rota pública. Não precisa de token porque a porta 8000 nunca sai da rede docker. |
| Coletor | **Prometheus** (retenção 15d) | padrão de fato; leve (~150 MB). |
| Host metrics | **node_exporter** | CPU/RAM/disco da VPS no mesmo painel (a VPS já ficou sem acesso 1×). |
| Painel | **Grafana** com datasource + dashboard + contact point **provisionados** (arquivo, não clique) | reproduzível; sobe pronto. |
| Alerta | **Grafana Unified Alerting** → contact point **Discord** nativo | Alertmanager precisaria de um bridge p/ Discord; Grafana fala Discord direto. |
| Acesso ao Grafana | `grafana.atennaia.com.br` (Cloudflare proxied → nginx → `grafana:3000`) | o dono precisa ver o painel pelo navegador; Grafana tem login próprio. Alertas no Discord funcionam **independente** do DNS. |
| Segredos | senha admin do Grafana em `/root/monitoring/ADMIN_PW.txt` (fora do git), igual GlitchTip | mesma convenção. |

## Métricas expostas

**Automáticas (instrumentator):**
- `http_request_duration_seconds` (histograma) — labels `method`, `handler`, `status`.
  Percentis via `histogram_quantile`.
- `http_requests_total` — labels idem.
- `http_requests_inprogress`.

**Custom de negócio (`backend/observability_metrics.py`, novo):**
| Métrica | Tipo | Incrementada em |
|---|---|---|
| `atenna_dlp_scans_total{risk_level}` | Counter | `pipeline.run` / `engine.revalidate` |
| `atenna_dlp_client_server_divergence_total` | Counter | cliente diz `NONE`/`LOW` e servidor acha `HIGH` |
| `atenna_dlp_strict_rewrites_total` | Counter | `evaluate_strict_enforcement` reescreveu PII |
| `atenna_quota_blocks_total{plan}` | Counter | `check_rate_limit` devolve 429 |
| `atenna_generate_prompts_total{provider,outcome}` | Counter | `prompt_service` (`openai`/`gemini`/`fallback` × `ok`/`error`) |
| `atenna_checkout_events_total{type}` | Counter | webhook Asaas (`PAYMENT_RECEIVED`, etc.) |
| `atenna_auth_failures_total{reason}` | Counter | `require_auth` (`raw_jwt`, `expired`, `no_session`) |
| `atenna_bff_session_store` | Gauge | `1`=Postgres, `0`=fallback in-memory (crítico) |

## Regras de alerta (→ Discord `#alertas-infra` ou `#geral`)

| Alerta | Condição | Severidade |
|---|---|---|
| **Backend fora do ar** | `up{job="atenna-backend"} == 0` por 2 min | crítico |
| **Taxa de 5xx alta** | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.01` por 5 min | crítico |
| **/generate-prompts lento** | `histogram_quantile(0.95, ...handler="/generate-prompts"...[10m]) > 8` por 10 min | aviso |
| **Sessão BFF em memória** | `atenna_bff_session_store == 0` por 1 min | crítico |
| **Divergência DLP** | `increase(atenna_dlp_client_server_divergence_total[15m]) > 5` | aviso |
| **Disco da VPS** | `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.15` | aviso |
| **RAM da VPS** | `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.10` por 10 min | aviso |

## Arquivos

```
infra/monitoring/
  docker-compose.yml          # prometheus + grafana + node_exporter
  .env.example
  README.md
  prometheus/prometheus.yml
  prometheus/rules.yml         # (opcional) alertas no Prometheus; hoje ficam no Grafana
  grafana/provisioning/datasources/prometheus.yml
  grafana/provisioning/dashboards/dashboards.yml
  grafana/provisioning/dashboards/atenna-overview.json
  grafana/provisioning/alerting/discord.yml       # contact point
  grafana/provisioning/alerting/rules.yml         # alert rules
backend/
  observability_metrics.py     # novo — Counters/Gauges custom
  routes/metrics.py            # reescrito — usa prometheus_client
  middleware/security_headers.py  # remove o contador manual
  requirements.txt             # + prometheus-fastapi-instrumentator, prometheus-client
nginx/default.conf (VPS + docs)  # + location = /metrics { return 404; }
```

## Testes (harness `backend/tests/test_metrics.py`)

1. `/metrics` responde `text/plain; version=0.0.4` e contém `http_request_duration_seconds_bucket`.
2. Após um `POST /dlp/scan`, `atenna_dlp_scans_total` subiu.
3. Cliente mente `dlp_risk_level=NONE` + CPF cru → `atenna_dlp_client_server_divergence_total` subiu.
4. Token free estourando cota → `atenna_quota_blocks_total{plan="free"}` subiu + resposta 429.
5. **Segurança:** `/metrics` via host público (simulado com header `X-Forwarded-Host`) — o
   bloqueio é no nginx, então o teste de nginx (`infra/`) valida `curl -s -o /dev/null -w %{http_code}`
   = 404 pelo domínio e 200 pela rede docker.
6. `atenna_bff_session_store` = 1 quando o Postgres responde; 0 quando forçado o fallback.

## Rollout

1. Backend instrumentado + `/metrics` novo — deploy (compatível: Prometheus text format).
2. nginx bloqueia `/metrics` público — deploy.
3. `infra/monitoring` sobe na VPS (`docker compose -p monitoring up -d`). Prometheus já raspa.
4. Grafana provisiona datasource + dashboard + alertas. Contact point Discord testado.
5. DNS `grafana.atennaia.com.br` (dono) + vhost nginx → painel acessível.
6. CHANGELOG + commit + push.
