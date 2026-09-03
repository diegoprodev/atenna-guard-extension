# FASE P3.4 — Backup do banco (Supabase Postgres)

**Status:** em implementação · **Parte de:** P3 CI/CD · **Não bloqueia:** republicar a extensão

## Problema

O banco de produção (Supabase Postgres, ref `kezbssjmgwtrunqeoyir`) tem **todos os dados
que importam**: `profiles`, `user_plans`, `subscriptions`, `bff_sessions`, `dlp_events`,
`checkout_events`. Se o projeto Supabase for deletado/corrompido/hackeado, **não há cópia
fora do Supabase**. O plano Free do Supabase **não faz backup automático** (Pro faz + PITR 7d).

## Descoberta técnica

- A VPS **tem IPv6 global** (`2a01:4f8:c012:7ef8::1`) e egress IPv6 funciona.
- `db.kezbssjmgwtrunqeoyir.supabase.co` resolve só em IPv6 — mas do **host** da VPS
  (não de dentro de um container) `psql`/`pg_dump` 17.11 conectam direto:
  `PGPASSWORD=$DB_PASSWORD psql "host=db.<ref>.supabase.co port=5432 user=postgres sslmode=require"` → OK.
- Ou seja: `pg_dump` roda direto da VPS, sem pooler, sem add-on IPv4.

## Decisões

| Tema | Decisão | Porquê |
|---|---|---|
| Ferramenta | `pg_dump --format=custom` (`.dump`) da VPS, cron diário | nativo, restaura seletivo, comprime |
| Escopo | banco todo (`--no-owner --no-privileges` p/ restore limpo) | simples e completo; o DB é pequeno |
| Cripto | **`age`** — chave pública na VPS (cifra), privada com o dono (decifra) | moderno, 1 binário, sem GPG keyring |
| Offsite | **Cloudflare R2** (bucket privado, S3-compat) via `rclone` | dono já tem Cloudflare; free tier (10 GB) cobre folgado; sai da infra |
| Retenção | 14 diários + 8 semanais no R2; `rclone` faz a poda | ~1 mês+ de história sem encher |
| Cópia local | 3 dumps mais recentes em `/root/backups/` (rollback rápido) | R2 fora do ar não deixa sem nada |
| Monitor | GlitchTip **cron check-in** (`observability.monitor`-style) via curl no DSN | alerta no Discord se o backup não rodar |
| Restore testado | script `restore-test.sh` → restaura num schema `_restore_test` e conta linhas | mensal (cron) — backup não testado = sem backup |

## Arquivos

```
infra/backup/
  backup-supabase.sh      # pg_dump -> age -> local + rclone R2 -> poda -> check-in GlitchTip
  restore-test.sh         # baixa o último, decifra, restaura em _restore_test, sanity check
  restore.sh              # restore de verdade (guiado, confirma 2x) — para emergência
  README.md               # setup do R2 + da chave age + como restaurar
  crontab.example
VPS:
  /root/backup/backup-supabase.sh          (deploy do script)
  /root/backup/.env                        (R2 creds + age recipient + GlitchTip slug) — fora do git
  /root/backups/                           (cópia local)
  /etc/cron.d/atenna-backup                (03:30 diário backup, 04:00 domingo restore-test)
```

## Setup do dono (uma vez)

1. **Cloudflare → R2 → Create bucket** `atenna-db-backups` (Location: automático, privado).
2. **R2 → Manage R2 API Tokens → Create** — permissão **Object Read & Write**, escopo só esse
   bucket. Anotar Access Key ID, Secret, e o **endpoint** `https://<accountid>.r2.cloudflarestorage.com`.
3. Passar os 3 valores pro Claude (vão pro `/root/backup/.env` da VPS, **não** pro git).
4. Guardar a **chave privada `age`** (o Claude gera; conteúdo vai pro cofre pessoal do dono —
   sem ela não dá pra restaurar).

## Testes / verificação

1. `backup-supabase.sh` roda à mão → cria `.dump.age` local + objeto no R2 + check-in no GlitchTip.
2. `age -d` com a chave privada decifra o dump; `pg_restore -l` lista o conteúdo.
3. `restore-test.sh` restaura em `_restore_test` e confere `count(*)` de `profiles` > 0.
4. Cron: matar o check-in (não rodar) → GlitchTip alerta no Discord em ~26h.
5. Segurança: o `.dump` cru **nunca** toca o disco sem cifrar (pipe `pg_dump | age`); `.env` 600.

## Rollout

Script → deploy VPS → `.env` com creds do dono → run manual + validar → cron → restore-test →
CHANGELOG → PR → merge.
