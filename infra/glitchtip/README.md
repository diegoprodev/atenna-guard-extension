# GlitchTip — observabilidade (error tracking + cron monitoring)

Self-hosted na VPS Hetzner em `/root/glitchtip/`. Sentry-compatível.
**Imagem: `glitchtip/glitchtip:6.2.6`** (ver "Armadilhas" abaixo).

## Subir
```bash
cd /root/glitchtip
cp .env.example .env   # preencher SECRET_KEY, PG_PW, EMAIL_URL, ALLOWED_HOSTS
docker compose -p glitchtip up -d
docker compose -p glitchtip run --rm web ./manage.py migrate   # se o migrate one-shot falhar
```

O serviço `gt-patches` roda depois do `migrate` e reaplica `patches/*.sql`
(idempotente) a cada `up`.

## Armadilhas (já custaram tempo)

1. **NÃO usar a tag `v4.2`.** Nesse build o handler `POST /api/<id>/envelope/`
   é um stub sem corpo: responde HTTP 200 e **descarta** o evento. Sintoma:
   `POST /api/1/envelope/ => 200` no log do `web`, mas `issues = 0`,
   `LLEN celery = 0`, worker só roda `process_event_alerts`. Correção: subir
   para `6.2.6` (tags mudaram de `vX.Y` para `X.Y.Z`).
2. **`get_project_auth_info()` com tipo errado no 6.2.6.** A migration declara a
   coluna `organization_id` como `bigint`, mas numa base nova em PG17 a coluna
   real é `integer` → erro `42804` em todo ingest → HTTP 500. Corrigido por
   `patches/01-fix-get_project_auth_info.sql` (recria a função com `integer`).
   Se o Postgres reclamar de "prepared statement"/plano em cache depois de
   aplicar: `docker compose -p glitchtip up -d --force-recreate web worker`.
3. **`ALLOWED_HOSTS`.** Sem a env var o Django fica no wildcard `*`. Definida no
   `.env` (`errors.atennaia.com.br,glitchtip-web-1,localhost`).

## Acesso
- URL: https://errors.atennaia.com.br (nginx do `atenna-backend` faz o proxy — precisa do DNS `errors` → 157.90.246.156 proxied)
- Superuser criado via `./manage.py shell` (ver senha em `/root/glitchtip/ADMIN_PW.txt` na VPS)
- Org **Atenna** · projetos **backend** (DSN interno) e **extension** (DSN público)

## DSNs
- Backend usa DSN **interno** via rede docker `atenna-backend_atenna`:
  `http://<key>@glitchtip-web-1:8080/1` (env `GLITCHTIP_DSN` no `backend/.env`) — não depende de DNS
- Extensão usa DSN **público** hardcoded em `src/core/observability.ts`:
  `https://<key>@errors.atennaia.com.br/2`

## Alertas
GlitchTip → Settings do projeto → **Alerts** → webhook Slack/Discord. Regras:
- Nova issue (imediato)
- Regressão (issue resolvida voltou)
- Pico: > N eventos em M minutos

Configurado hoje (2026-09-02): os dois projetos (`backend` e `extension`) têm um
alerta "Erros (qualquer)" — `quantity=1`, `timespan=1 min` — com um
`AlertRecipient` do tipo `discord` apontando para o webhook do canal `#geral`.
Pipeline validado ponta a ponta: envelope → issue → `process_event_alerts` →
`send_notification` → Discord (`alerts_notification.is_sent = true`).

## Cron monitoring
Os jobs do scheduler (`backend/main.py`) fazem check-in via `observability.monitor(slug)`.
Se um job não rodar na janela esperada → GlitchTip alerta. Slugs:
`daily-renewal-30d`, `daily-renewal-7d`, `daily-onboarding-d1`, `daily-upsell`, `daily-dlp-cleanup`.

## Backup
O Postgres do GlitchTip (`pg_data` volume) tem os eventos. Retenção = 90 dias
(`GLITCHTIP_MAX_EVENT_LIFE_DAYS`). Backup opcional — perder eventos históricos
não é crítico; o que importa é o alerta em tempo real.

## Recursos
~1 GB RAM (web + worker + postgres + valkey). VPS tem folga (8 GB, ~1.5 GB em uso).
