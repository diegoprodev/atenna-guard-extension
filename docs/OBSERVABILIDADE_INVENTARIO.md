# Observabilidade — Inventário Ponta a Ponta

> Varredura completa do que a Atenna tem de observabilidade hoje (2026-09-08).
> Serve de referência pra replicar o mesmo padrão em outro sistema.
> O prompt de replicação está em `docs/OBSERVABILIDADE_PROMPT_REPLICACAO.md`.

---

## Visão geral — 6 camadas

| # | Camada | Ferramenta | Estado | Onde vive |
|---|---|---|---|---|
| 1 | **Error tracking** | GlitchTip 6.2.6 (self-hosted, Sentry-compat) | ✅ produção | `infra/glitchtip/` + `backend/observability.py` + `src/core/observability.ts` |
| 2 | **Métricas / séries temporais** | Prometheus + Grafana | 🟡 instrumentação feita · coletor/painel EM ABERTO | `backend/observability_metrics.py` + `backend/routes/metrics.py` · spec `docs/specs/FASE_9.1_METRICAS_GRAFANA.md` |
| 3 | **SIEM / eventos de segurança** | Próprio (`SecurityMonitor`) | ✅ produção | `backend/security/monitor.py` + `backend/routes/admin_security.py` |
| 4 | **Uptime externo** | UptimeRobot (free) | ✅ produção | conta do dono — 3 monitores HTTP/5min |
| 5 | **Alertas** | Discord (webhook) + e-mail (Resend) | ✅ produção | GlitchTip AlertRecipient · UptimeRobot integration · `SecurityMonitor._send_security_alert` |
| 6 | **Telemetria de negócio** | Tabela `dlp_events` (Supabase) + `/track` | ✅ produção | `backend/routes/analytics.py` + `backend/dlp/telemetry*.py` |

---

## 1. Error tracking — GlitchTip

### 1.1 Infra (self-hosted na VPS Hetzner, `/root/glitchtip/`)

`infra/glitchtip/docker-compose.yml` — projeto compose `glitchtip`:

| Serviço | Imagem | Papel |
|---|---|---|
| `web` | `glitchtip/glitchtip:6.2.6` | API + UI (porta 8080) |
| `worker` | idem, `run-celery-with-beat.sh` | processa eventos + alertas + beat |
| `migrate` | idem, one-shot | `./manage.py migrate` |
| `gt-patches` | `postgres:17-alpine` | reaplica `patches/*.sql` idempotentes a cada `up` |
| `postgres` | `postgres:17-alpine` | armazena eventos (volume `pg_data`) |
| `redis` | `valkey/valkey:8-alpine` | fila do Celery |

Redes: `gt` (interna) + `atenna-backend_atenna` (external — o `web` fica visível pro backend por DNS `glitchtip-web-1`).
Proxy: nginx do `atenna-backend` → `https://errors.atennaia.com.br`.
Recursos: ~1 GB RAM. Retenção: **90 dias** (`GLITCHTIP_MAX_EVENT_LIFE_DAYS`).

`.env` (`infra/glitchtip/.env.example`):
```
SECRET_KEY=            # openssl rand -hex 32
PG_PW=                 # openssl rand -hex 16
GLITCHTIP_DOMAIN=https://errors.atennaia.com.br
ALLOWED_HOSTS=errors.atennaia.com.br,glitchtip-web-1,localhost
DEFAULT_FROM_EMAIL=alertas@pluginmail.atennaia.com.br
EMAIL_URL=smtp+tls://resend:<RESEND_API_KEY>@smtp.resend.com:587
ENABLE_OPEN_USER_REGISTRATION=false
GLITCHTIP_MAX_EVENT_LIFE_DAYS=90
```

**Armadilhas já pagas (documentadas em `infra/glitchtip/README.md`):**
1. **NÃO usar tag `vX.Y` (ex.: `v4.2`)** — naquele build `POST /api/<id>/envelope/` é stub sem corpo: responde 200 e **descarta** o evento. Sintoma: `issues=0` apesar de `sentry_sdk.flush()` OK. Usar `X.Y.Z` (`6.2.6`).
2. **`get_project_auth_info()` no 6.2.6** declara `organization_id` como `bigint`, mas base nova em PG17 tem `integer` → erro `42804` em todo ingest → HTTP 500. Fix: `patches/01-fix-get_project_auth_info.sql` (recria a função com `integer`), reaplicado pelo serviço `gt-patches`.
3. **`ALLOWED_HOSTS`** — sem a env o Django fica em wildcard `*`.

### 1.2 Backend — `backend/observability.py`

- SDK: `sentry_sdk` com integrations `Starlette`, `FastApi`, `Asyncio`, `Logging`.
- **`LoggingIntegration(level=None, event_level="ERROR")`** — qualquer `logger.error()` em qualquer lugar vira issue no GlitchTip automaticamente. `print()` **não**.
- `traces_sample_rate=0.0` — GlitchTip é foco em erro, perf desligada.
- `send_default_pii=False`, `max_request_body_size="small"`.
- **`before_send` = scrub de PII** antes de sair: regex pra CPF, CNPJ, e-mail, cartão, Bearer, JWT, chaves (`sk-`, `sk_live_`, `re_`, `AKIA`, `AIza`). Chaves de header sensíveis (`authorization`, `cookie`, `token`, `supabase_jwt`, `service_role_key`, …) viram `[Filtered]`. Varre `request.data/headers/query/cookies/env`, `breadcrumbs`, `exception.values`, `logentry`, `extra`.
- `set_request_user(user_id, email, plan)` — chamado no `require_auth`, anexa "quem" à issue (só id + tag `plan`).
- **`monitor(slug)`** — decorator pros jobs do scheduler: check-in de cron. Se o job não rodar na janela → GlitchTip alerta.
- Liga só se `GLITCHTIP_DSN` (ou `SENTRY_DSN`) no ambiente. Sem DSN = no-op.
- DSN backend: `http://a1b9ba5b68024c57b013a171ce593928@glitchtip-web-1:8080/1` (**rede docker interna** — não depende de DNS).

### 1.3 Extensão — `src/core/observability.ts`

- **Dependency-free** (o `content.js` carrega em toda página de IA — cada KB conta). Implementa o protocolo Sentry envelope na mão via `fetch`.
- Captura: `window.onerror`, `unhandledrejection`, e `reportError(err, context)` manual.
- `initObservability(surface)` — `surface` ∈ `background|content|popup|welcome`.
- Contexto anexado: `surface`, `platform` (chatgpt/claude/gemini/perplexity derivado do hostname), `release` (`atenna-safe-prompt@<versão>`), `environment=production`, `user.id`, tag `plan`.
- **PII scrub** igual ao backend (JWT, keys, Bearer, CPF, CNPJ, cartão, e-mail).
- **Dedupe de rajada**: mesma assinatura em <5s é descartada.
- `parseFrames()` — transforma o stack em frames Sentry (`filename`, `lineno`, `colno`, `in_app`).
- `keepalive: true` no fetch (sobrevive ao fechamento da aba).
- DSN público (write-only ingest, **não é segredo**): `https://8c4039cd2a10459fa000564b7ec0ef55@errors.atennaia.com.br/2`.

### 1.4 Projetos no GlitchTip

Org **Atenna** · 2 projetos:
- **backend** (project id 1) — DSN interno
- **extension** (project id 2) — DSN público

Superuser: `devdiegopro@gmail.com`, senha em `/root/glitchtip/ADMIN_PW.txt` (VPS, fora do git).

---

## 2. Métricas — Prometheus (instrumentação ✅ · painel 🟡)

### 2.1 O que já existe

`backend/main.py`:
```python
Instrumentator(excluded_handlers=["/metrics", "/health"], should_group_status_codes=False).instrument(app)
```
→ `prometheus-fastapi-instrumentator` dá de graça:
- `http_request_duration_seconds` (histograma) — labels `method`, `handler`, `status` → percentis via `histogram_quantile`
- `http_requests_total`, `http_requests_inprogress`

`backend/observability_metrics.py` — **12 métricas de negócio** (Counter/Gauge), cada helper best-effort (métrica nunca quebra o fluxo):

| Métrica | Tipo | Labels | Sobe quando |
|---|---|---|---|
| `atenna_dlp_scans_total` | Counter | `risk_level` | revalidação DLP server-side |
| `atenna_dlp_client_server_divergence_total` | Counter | — | cliente disse risco menor que o servidor apurou (bypass) |
| `atenna_dlp_strict_rewrites_total` | Counter | — | STRICT_DLP_MODE reescreveu PII |
| `atenna_quota_blocks_total` | Counter | `plan` | HTTP 429 por cota |
| `atenna_generate_prompts_total` | Counter | `provider`, `outcome` | geração (`openai`/`gemini`/`none` × `ok`/`error`/`fallback`) |
| `atenna_checkout_events_total` | Counter | `type` | webhook Asaas |
| `atenna_auth_failures_total` | Counter | `reason` | `require_auth` (`raw_jwt`/`expired`/`invalid_session`/`error`) |
| `atenna_pro_ip_lock_blocks_total` | Counter | `mode` | conta PRO em 2º IP (`shadow`/`enforce`) |
| `atenna_bff_session_store` | Gauge | — | `1`=Postgres, `0`=fallback in-memory (crítico) |
| `atenna_subscriptions_total` | Gauge | `bucket` | plano×status de `user_plans` + `profiles_pro` |
| `atenna_subscription_sync_mismatch` | Gauge | — | nº de usuários com plano divergente entre tabelas (BUG-01) |
| `atenna_last_checkout_event_age_seconds` | Gauge | — | idade do último evento de checkout (webhook quebrado?) |

`backend/routes/metrics.py` — `GET /metrics` em formato texto Prometheus.
**Segurança:** nginx bloqueia no público (`location = /metrics { return 404; }`); Prometheus raspa `http://backend:8000/metrics` **pela rede docker** — sem token porque a 8000 nunca sai da rede.

`backend/document/observability.py` — métricas in-memory do pipeline de documento (parse duration p50/p95/p99, delta de RAM, rejection rate, timeout, concurrent peak, cleanup latency). Exportável via `/document/metrics` (interno). Reset no restart.

### 2.2 O que falta (FASE 9.1 parte 2 — `docs/specs/FASE_9.1_METRICAS_GRAFANA.md`)

Não deployado. Duas opções em aberto (dono decide):
- **(a) self-hosted:** Prometheus (retenção 15d) + Grafana + `node_exporter` em containers na VPS
- **(b) Grafana Cloud (free):** agente leve (`grafana-agent`/`alloy` ou Prometheus modo `agent` com `remote_write`) empurrando `/metrics` + `node_exporter`. Ganha métricas do Postgres do Supabase de graça. **Recomendado.**

Arquivos previstos: `infra/monitoring/` (compose, `prometheus/prometheus.yml`, `grafana/provisioning/{datasources,dashboards,alerting}/*`).

**Regras de alerta previstas (→ Discord):**
| Alerta | Condição | Sev |
|---|---|---|
| Backend fora | `up{job="atenna-backend"} == 0` por 2 min | crítico |
| 5xx alto | `rate(5xx[5m]) / rate(all[5m]) > 0.01` por 5 min | crítico |
| `/generate-prompts` lento | `histogram_quantile(0.95, ...[10m]) > 8s` por 10 min | aviso |
| Sessão BFF em memória | `atenna_bff_session_store == 0` por 1 min | crítico |
| Divergência DLP | `increase(...divergence_total[15m]) > 5` | aviso |
| Disco VPS | `avail/size < 0.15` | aviso |
| RAM VPS | `MemAvailable/MemTotal < 0.10` por 10 min | aviso |

---

## 3. SIEM — `backend/security/monitor.py`

Camada própria (não usa ferramenta externa). "A09 Enterprise SIEM Layer".

- **Log estruturado append-only:** `security_events.jsonl` (`SECURITY_LOG_PATH`, default `/app/data/security_events.jsonl`). Cada linha = 1 JSON `{ts, severity, event, user_id, ip, ...data}`.
- **Ring buffer in-memory:** últimos 500 eventos (pro dashboard, sem I/O).
- **Taxonomia de severidade** (dict `SEVERITY`):
  - `CRITICAL`: `admin_access_denied/granted`, `webhook_auth_failed`, `webhook_token_missing`, `auth_burst_detected`, `bff_sessions_fallback`
  - `HIGH`: `dlp_strict_applied`, `dlp_analysis_failed`, `token_expired_burst`
  - `MEDIUM`: `login_rate_limited`, `auth_failure`, `checkout_anomaly`
  - `LOW`: `plan_upgraded/downgraded`, `cleanup_ran`
- **`log_security_event(type, data, user_id, ip, severity)`** — grava ring + arquivo, faz `logger.warning("[SEC:...]")` (que NÃO vira issue — só ERROR vira), e dispara alerta async pra `CRITICAL`/`HIGH`.
- **Auth burst detector:** `record_auth_failure(ip)` — deque por IP; se `>= AUTH_BURST_MAX` (10) em `AUTH_BURST_WINDOW` (300s) → evento `auth_burst_detected` CRITICAL, retorna `True` (caller decide bloquear).
- **Alerta por e-mail** (`_send_security_alert`) — via `routes.email_service.send_email` (Resend). HTML escuro com tabela (event/time/user/ip) + `<pre>` do JSON. Link pro `/admin/security/events`. **Cooldown 5min por tipo** (`ALERT_COOLDOWN`) pra não floodar.
- **Dashboard:** `backend/routes/admin_security.py`
  - `GET /admin/security/events?limit&severity` — ring buffer (auth: `require_auth` + `ADMIN_EMAILS` gate; tentativa negada gera evento CRITICAL)
  - `GET /admin/security/summary` — contagem por severidade + top 10 tipos + IPs ativos

---

## 4. Uptime externo — UptimeRobot

Conta do dono (login Google). Better Stack foi abandonado (onboarding exigia telefone).

- **3 monitores HTTP, intervalo 5 min:**
  - `api.atennaia.com.br/health`
  - `errors.atennaia.com.br`
  - `plugin.atennaia.com.br`
- Alerta: **e-mail + integração Discord** ("Discord integration #1") nos 3.
- **Limitação do plano grátis:** não deixa trocar método pra `GET` (usa `HEAD`) nem usar keyword. Por isso `/health` no backend aceita **`HEAD` além de `GET`**:
  ```python
  @app.api_route("/health", methods=["GET", "HEAD"], tags=["Health"])
  ```
- Página pública de status: o UptimeRobot oferece de graça (não configurada ainda).

---

## 5. Alertas — canais

| Origem | Canal | Config |
|---|---|---|
| GlitchTip (nova issue / regressão / pico) | **Discord** `#geral` | `ProjectAlert` "Erros (qualquer)" `quantity=1 timespan=1min` + `AlertRecipient` type `discord` → webhook. Validado: `alerts_notification.is_sent=true`. Nos 2 projetos. |
| UptimeRobot (down/up) | **Discord** + e-mail | integração nativa nos 3 monitores |
| SecurityMonitor (CRITICAL/HIGH) | **e-mail** (Resend) | `ADMIN_EMAILS[0]`, cooldown 5min/tipo |
| Scheduler cron miss/fail | **Discord** (via GlitchTip) | `observability.monitor(slug)` check-in |
| Grafana alerting (previsto) | **Discord** | contact point nativo (Grafana fala Discord direto, sem bridge) |

---

## 6. Telemetria de negócio

- **`POST /track`** (`backend/routes/analytics.py`) — `Depends(require_auth)`, payload `dict` arbitrário sanitizado server-side. Grava em `dlp_events` (Supabase).
- **`backend/dlp/telemetry.py`** — `TelemetryEvent` (event_type, timestamp, payload_hash, entity_types, entity_count, risk_level). Nunca guarda valor de PII — só `payload_hash` (djb2/hash) + tipos.
- **`telemetry_persistence.py`** — fallback in-memory quando o Supabase não responde.
- **`supabase_telemetry.py`** — persistência real + fallback.
- Uso: `/auth/usage` conta `dlp_events` com `event_type='generate_prompt'` do dia (fuso `America/Sao_Paulo`) pra montar o contador "Hoje: X/5".

---

## 7. Health checks & cron monitoring

- **`GET|HEAD /health`** → `{"status":"ok"}`. Excluído das métricas do instrumentator.
- **Scheduler** (`AsyncIOScheduler`, tz `America/Sao_Paulo`) — 6 jobs, cada um embrulhado em `observability.monitor(slug)`:

| Slug | Cron | Job |
|---|---|---|
| `daily-renewal-30d` | 09:00 | aviso de renovação 30d |
| `daily-renewal-7d` | 09:15 | aviso de renovação 7d |
| `daily-onboarding-d1` | 10:00 | e-mail onboarding D1 |
| `daily-upsell` | 11:00 | e-mail de upsell |
| `daily-dlp-cleanup` | 03:00 | purga de `dlp_events` velhos |
| `daily-subscription-health` | 06:00 | `subscription_health.check()` — divergência de plano em 3 tabelas |

- **Backup do banco** (`infra/backup/`) — 2 monitores de cron no GlitchTip: `atenna-db-backup` (`30 3 * * *`, margin 90min), `atenna-db-restore-test` (`15 4 * * 0`). O script faz `curl` na check-in URL no fim.

---

## 8. Logging estruturado

- Container: logs JSON no stdout (`docker compose logs`).
- `logger.error(...)` em qualquer módulo → **issue no GlitchTip** (via `LoggingIntegration(event_level="ERROR")`).
- `logger.warning(...)` → só log, não vira issue (usado pelo SecurityMonitor de propósito).
- **Regra de ouro do projeto:** "jamais quero saber de um erro depois do user" → nada de `print()` pra erro; `logger.error()` sempre.

---

## 9. Dashboards (admin SPA — `admin/`)

React SPA protegida por token + `ADMIN_EMAILS`. Páginas relevantes:
- **Uso e Custos** (`admin/src/pages/UsageCosts.tsx`) — custo real por LLM/modelo do **Cloudflare AI Gateway** (`/admin/costs` → `_fetch_cf_metrics` chama a API de logs do CF Gateway), USD + BRL (conversão ao vivo), toggle 1-clique.
- **Visão Geral** (`Overview.tsx`), **Planos** (`Plans.tsx`).
- `MetricCard.tsx` — componente de KPI.
- Security events: `/admin/security/events` + `/summary` (JSON, consumido pelo painel).

---

## 10. Resumo do fluxo de um erro

```
ERRO no backend
  │  logger.error("...")  (ou exceção não tratada)
  ▼
sentry_sdk (LoggingIntegration event_level=ERROR)
  │  before_send: scrub CPF/CNPJ/email/JWT/keys
  ▼
POST http://glitchtip-web-1:8080/api/1/envelope/   (rede docker interna)
  ▼
GlitchTip web → Celery worker → cria/agrupa Issue
  ▼
process_event_alerts → ProjectAlert "Erros (qualquer)" (>=1 em 1min)
  ▼
send_notification → AlertRecipient discord → webhook #geral
  ▼
mensagem no Discord  ✅


ERRO na extensão (window.onerror / unhandledrejection / reportError)
  │  scrub PII + dedupe rajada (5s)
  ▼
fetch POST https://errors.atennaia.com.br/api/2/envelope/  (DSN público, keepalive)
  ▼
GlitchTip projeto "extension" → mesma pipeline → Discord #geral
```

---

## 11. Lacunas conhecidas

| Lacuna | Impacto | Onde está planejado |
|---|---|---|
| Prometheus + Grafana não deployados | sem painel de latência/5xx, sem alerta de **degradação** (só de quebra) | FASE 9.1 parte 2 |
| Página pública de status | — (nice-to-have; UptimeRobot faz de graça) | — |
| Backup dos eventos do GlitchTip | perde histórico se o volume morrer (não crítico — alerta é em tempo real) | — |
| `security_events.jsonl` sem rotação | cresce pra sempre | — |
| `/track` aceita payload arbitrário (sanitizado, mas sem schema) | ruído | P-ZT.2 |
