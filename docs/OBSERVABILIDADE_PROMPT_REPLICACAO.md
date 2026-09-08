# Prompt de replicação — Observabilidade enterprise no ANDRÔMEDA

> Cole o bloco abaixo inteiro num Claude Code rodando **no repositório do ANDRÔMEDA**.
> Ele descreve o padrão de observabilidade que já roda em produção na Atenna e pede
> a implementação equivalente, adaptada ao ANDRÔMEDA.
>
> Antes de colar: preencha os `<...>` que você souber (URL, domínio, provider de e-mail,
> canal do Discord). O resto o próprio Claude vai descobrir/perguntar.

---

```
Quero implementar uma stack de observabilidade enterprise neste projeto (ANDRÔMEDA),
espelhando o que já roda em produção em outro sistema meu (Atenna Safe Prompt). Não
copie cego — primeiro entenda o ANDRÔMEDA, depois adapte.

## Regras de trabalho (inegociáveis)

- Responda sempre em pt-BR.
- Toda tarefa passa pelo ciclo canônico ANTES de commit/push/deploy:
  1. Spec em `docs/specs/` (problema, decisões em tabela, arquivos, contrato, riscos, rollout)
  2. Testes: comportamental por feature, regressão por bug, bypass por regra de segurança —
     rodar e reportar o número real
  3. Code review com 3 chapéus (arquiteto sênior / product owner / estrategista)
  4. Entrada no CHANGELOG (o que era, o que quebrava, o que mudou, como validou, nº de testes)
  5. Só então commit → push → deploy
- Zero-trust: nada de segredo no cliente; nada de endpoint interno exposto no público.
- Nunca commitar `.env` / chaves / DSN privado.
- Nada de `print()` pra erro — logger estruturado sempre. "Jamais quero saber de um erro
  depois do usuário."
- Um PR pequeno por camada. Não empilhar tudo num commit.

## Fase 0 — Inventário do ANDRÔMEDA (faça primeiro, me devolva um resumo)

Varra o repo e me diga:
- Stack do backend (linguagem/framework), como sobe (docker-compose? VPS? serverless?), qual host
- Banco (é Supabase? Postgres? versão?), quantos projetos/ambientes
- O que já existe de observabilidade (logging, health check, qualquer /metrics, Sentry, etc.)
- Frontend/cliente que precisa de error tracking também (web app? extensão? mobile?)
- Onde ficam os segredos hoje
- Se já tem VPS com folga de RAM (~1.5 GB livre) pra self-hosted, ou se prefere SaaS/cloud

Com isso, me proponha o plano adaptado antes de codar.

## O padrão a replicar (6 camadas)

### 1. Error tracking — GlitchTip self-hosted (Sentry-compatível)

Infra (docker-compose próprio, projeto `glitchtip`):
- `glitchtip/glitchtip:6.2.6` (web + worker com celery-beat + migrate one-shot)
- `postgres:17-alpine` (volume dedicado) + `valkey/valkey:8-alpine` (fila celery)
- serviço `gt-patches` (postgres:17-alpine) que reaplica `patches/*.sql` idempotentes a cada `up`
- retenção `GLITCHTIP_MAX_EVENT_LIFE_DAYS=90`
- proxy reverso (nginx/caddy) → `errors.<dominio-do-andromeda>`
- `.env`: `SECRET_KEY` (openssl rand -hex 32), `PG_PW`, `ALLOWED_HOSTS` (SEM isso o Django
  fica em wildcard `*`), `EMAIL_URL` (smtp do provedor transacional), `ENABLE_OPEN_USER_REGISTRATION=false`

ARMADILHAS já pagas na Atenna — não repita:
- NÃO usar tags no formato `vX.Y` (ex.: `v4.2`): nesse build o handler
  `POST /api/<id>/envelope/` é um stub que responde 200 e DESCARTA o evento
  (sintoma: `issues=0` com `flush()` OK). Usar `X.Y.Z` — hoje `6.2.6`.
- No 6.2.6 + Postgres 17 base nova: a função `get_project_auth_info()` declara
  `organization_id` como `bigint` mas a coluna real é `integer` → erro `42804`
  em todo ingest → HTTP 500. Patch: recriar a função com `integer`, idempotente,
  reaplicado pelo serviço `gt-patches`. Se o PG reclamar de plano em cache:
  `docker compose up -d --force-recreate web worker`.

Backend (módulo `observability.py` equivalente):
- SDK Sentry oficial da linguagem, integrations do framework + logging
- LIGA SÓ SE `GLITCHTIP_DSN` (ou `SENTRY_DSN`) no ambiente — sem DSN = no-op total
- integração de logging configurada pra que **log de nível ERROR vire issue automaticamente**
  (o equivalente ao `LoggingIntegration(level=None, event_level="ERROR")` do Python)
- `traces_sample_rate=0` (foco em erro, não perf), `send_default_pii=false`,
  `max_request_body_size` pequeno
- **`before_send` com scrub de PII** — regex pra CPF, CNPJ, e-mail, cartão, `Bearer <token>`,
  JWT (`eyJ...`), chaves (`sk-`, `sk_live_`, `re_`, `AKIA`, `AIza`). Chaves de header/campo
  sensíveis (`authorization`, `cookie`, `token`, `*_jwt`, `service_role_key`, `password`, …)
  → `[Filtered]`. Varrer request (data/headers/query/cookies), breadcrumbs, exception values,
  logentry, extra.
- helper `set_request_user(id, email, plan)` chamado no middleware de auth (só id + tag de plano)
- decorator `monitor(slug)` pros jobs agendados (cron check-in — alerta se o job sumir)
- DSN do backend deve ser o INTERNO (via rede docker, ex.: `http://<key>@glitchtip-web-1:8080/1`)
  pra não depender de DNS

Cliente (se houver front/extensão) — módulo `observability` equivalente:
- se for extensão/bundle sensível a tamanho: implementar o protocolo Sentry envelope
  na mão via `fetch`, SEM dependência npm (a Atenna faz assim)
- capturar `window.onerror` + `unhandledrejection` + `reportError(err, context)` manual
- contexto: surface, plataforma, release (`<app>@<versão>`), environment, user.id, tag plano
- MESMO scrub de PII do backend
- dedupe de rajada (mesma assinatura em <5s → descarta)
- `fetch` com `keepalive: true`
- DSN público (write-only ingest — não é segredo, pode hardcodar)

Projetos no GlitchTip: um por superfície (`backend`, `web`, `extension`…), org única.

### 2. Métricas — Prometheus + Grafana

Backend:
- instrumentador HTTP do framework (histograma de latência por rota/método/status) →
  percentis via `histogram_quantile`
- módulo `observability_metrics` com Counters/Gauges de NEGÓCIO (o que o instrumentador não
  sabe): as métricas específicas do ANDRÔMEDA. Cada helper best-effort — **métrica nunca
  quebra o fluxo** (import guardado + try/except em cada `.inc()`/`.set()`)
- `GET /metrics` em formato texto Prometheus
- **/metrics BLOQUEADO no proxy público** (`location = /metrics { return 404; }`); o Prometheus
  raspa pela rede interna docker (`http://backend:8000/metrics`) — sem token porque a porta
  nunca sai da rede

Coletor + painel (escolher, me perguntar):
- (a) self-hosted: Prometheus (retenção 15d) + Grafana + `node_exporter`, em containers
- (b) Grafana Cloud (free) + agente leve (`alloy`/`grafana-agent` ou Prometheus modo `agent`
  com `remote_write`) — menos infra, sobrevive à VPS cair. Se o ANDRÔMEDA usa Supabase,
  ganha as métricas do Postgres de graça pela integração nativa. **Recomendo (b).**
- Grafana com datasource + dashboards + contact point **provisionados por arquivo** (não clique)
- Alerting do Grafana → **contact point Discord nativo** (Grafana fala Discord direto)

Regras de alerta (adaptar limiares ao ANDRÔMEDA):
- backend fora: `up == 0` por 2min → crítico
- 5xx alto: `rate(5xx[5m]) / rate(all[5m]) > 0.01` por 5min → crítico
- rota crítica lenta: `histogram_quantile(0.95, ...[10m]) > <SLA>` por 10min → aviso
- disco: `avail/size < 0.15` → aviso · RAM: `MemAvailable/MemTotal < 0.10` por 10min → aviso
- + as métricas de negócio do ANDRÔMEDA que indicam degradação

### 3. SIEM — camada própria de eventos de segurança

Módulo `security/monitor.py` equivalente:
- log estruturado append-only em `security_events.jsonl` (1 JSON por linha:
  `{ts, severity, event, user_id, ip, ...data}`)
- ring buffer in-memory (últimos ~500) pro dashboard sem I/O
- taxonomia de severidade num dict (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`) mapeando os tipos
  de evento do ANDRÔMEDA (acesso admin, falha de webhook, burst de auth, fallback de sessão,
  anomalia de pagamento, mudança de plano, …)
- `log_security_event(type, data, user_id, ip, severity)` — grava ring + arquivo, faz
  `logger.warning("[SEC:...]")` (warning de propósito — NÃO vira issue), dispara alerta
  async pra CRITICAL/HIGH
- detector de burst de falha de auth por IP (deque; `>= N` em `W` segundos → evento
  CRITICAL + sinal pro caller bloquear)
- alerta por e-mail (HTML) com **cooldown por tipo** (ex.: 5min) pra não floodar
- endpoints `GET /admin/security/events?limit&severity` e `/summary` (protegidos por
  auth + allowlist de e-mail de admin; tentativa negada gera evento CRITICAL)

### 4. Uptime externo — UptimeRobot (free)

- 3+ monitores HTTP, intervalo 5min: `<host>/health`, `errors.<host>`, e o app público
- alerta e-mail + **integração Discord**
- ATENÇÃO ao plano grátis: não deixa trocar método pra GET nem usar keyword → o
  `/health` do backend TEM que aceitar `HEAD` além de `GET`
- ligar a página pública de status (UptimeRobot dá de graça)

### 5. Alertas — canais

| Origem | Canal |
|---|---|
| GlitchTip (nova issue / regressão / pico >=N em Mmin) | Discord (webhook, via `AlertRecipient` type discord) |
| UptimeRobot (down/up) | Discord + e-mail |
| SecurityMonitor (CRITICAL/HIGH) | e-mail (provedor transacional), cooldown por tipo |
| Cron miss/fail | Discord (via GlitchTip crons/monitors) |
| Grafana alerting | Discord (contact point nativo) |

Canal do Discord: `<webhook ou nome do canal>`. Validar ponta a ponta cada um
(disparar um evento de teste e confirmar que a mensagem chega).

### 6. Health checks & cron monitoring

- `GET|HEAD /health` → `{"status":"ok"}`, excluído das métricas
- todo job agendado embrulhado no decorator `monitor(slug)` (check-in no GlitchTip) — se o
  job não rodar na janela esperada, alerta
- job de backup do banco com check-in URL no fim (curl)

## Logging

- logs JSON estruturados no stdout
- `logger.error()` → vira issue no GlitchTip · `logger.warning()` → só log
- nunca `print()` pra erro

## Entregáveis

1. `docs/specs/FASE_OBSERVABILIDADE.md` — spec canônica
2. `infra/glitchtip/` — compose + `.env.example` + `README.md` (com as armadilhas) + `patches/`
3. `infra/monitoring/` — compose ou config do agente + provisioning do Grafana
4. `<backend>/observability.*` + `<backend>/observability_metrics.*` + rota `/metrics`
5. `<backend>/security/monitor.*` + rotas `/admin/security/*`
6. módulo de observabilidade do cliente (se houver front)
7. `/health` com HEAD
8. testes: `/metrics` responde e contém histograma; métrica de negócio sobe após ação;
   `/metrics` = 404 pelo domínio público e 200 pela rede interna; evento de segurança
   grava no ring + arquivo; burst detector dispara
9. checklist manual: disparar 1 erro real no backend e 1 no cliente → confirmar issue no
   GlitchTip → confirmar mensagem no Discord. Derrubar o backend → confirmar alerta
   UptimeRobot no Discord.
10. entrada no CHANGELOG + specs atualizadas

## O que EU (dono) faço fora do código — me dê a lista no fim

- DNS `errors.<host>` e `grafana.<host>` (se self-hosted)
- criar superuser do GlitchTip + org + projetos + copiar os DSN pro `.env`
- criar o webhook do Discord + colar nos `AlertRecipient` / contact points
- conta UptimeRobot + 3 monitores + integração Discord
- (se Grafana Cloud) criar a stack + token de `remote_write`
- setar os segredos no ambiente de produção

Comece pela Fase 0 (inventário) e me devolva o plano adaptado antes de escrever código.
```

---

## Referência completa do que já existe na Atenna

O inventário detalhado (arquivo por arquivo, com trechos de código, DSNs, slugs de cron,
regras de alerta, o fluxo completo de um erro) está em
[`docs/OBSERVABILIDADE_INVENTARIO.md`](OBSERVABILIDADE_INVENTARIO.md). Se o outro Claude
tiver acesso a este repo, mande ele ler esse arquivo primeiro.
