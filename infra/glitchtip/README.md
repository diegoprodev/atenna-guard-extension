# GlitchTip — observabilidade (error tracking + cron monitoring)

Self-hosted na VPS Hetzner em `/root/glitchtip/`. Sentry-compatível.

## Subir
```bash
cd /root/glitchtip
cp .env.example .env   # preencher SECRET_KEY, PG_PW, EMAIL_URL
docker compose -p glitchtip up -d
docker compose -p glitchtip run --rm web ./manage.py migrate   # se o migrate one-shot falhar
```

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
