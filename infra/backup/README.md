# Backup do banco (Supabase Postgres)

Spec: `docs/specs/FASE_P3.4_BACKUP_BANCO.md`.

`pg_dump` (direto da VPS, via IPv6) → `age` (cifra) → cópia local (`/root/backups/`, 3 últimas)
+ Cloudflare R2 (`daily/` 14, `weekly/` 8) → check-in no GlitchTip (alerta no Discord se não rodar).

## Setup (uma vez)

### 1. Chave `age` (cifra/decifra)
Na VPS:
```bash
apt-get install -y age rclone
age-keygen -o /root/backup/age-key.txt        # gera par
chmod 600 /root/backup/age-key.txt
grep 'public key' /root/backup/age-key.txt    # -> AGE_RECIPIENT
```
**Copiar `/root/backup/age-key.txt` inteiro para o cofre pessoal do dono.**
Sem a chave privada, os backups são inúteis.

### 2. Cloudflare R2
1. Cloudflare → **R2** → **Create bucket** `atenna-db-backups` (privado).
2. **Manage R2 API Tokens → Create** → *Object Read & Write*, só nesse bucket.
   Anotar: Access Key ID, Secret Access Key, endpoint `https://<accountid>.r2.cloudflarestorage.com`.

### 3. `/root/backup/.env` (na VPS, 600, fora do git)
```
SUPABASE_DB_HOST=db.kezbssjmgwtrunqeoyir.supabase.co
SUPABASE_DB_PASSWORD=<senha do DB — igual DB_PASSWORD do backend/.env>
AGE_RECIPIENT=age1...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_BUCKET=atenna-db-backups
GLITCHTIP_MONITOR_URL=            # ver "monitor" abaixo
GLITCHTIP_RESTORE_MONITOR_URL=
```

### 4. Cron
```bash
cp crontab.example /etc/cron.d/atenna-backup
```

### 5. Monitor no GlitchTip
GlitchTip → projeto `backend` → **Crons / Monitors** → New:
- `atenna-db-backup` — schedule `30 3 * * *`, margin 90 min → copiar a URL de check-in → `GLITCHTIP_MONITOR_URL`
- `atenna-db-restore-test` — schedule `15 4 * * 0` → `GLITCHTIP_RESTORE_MONITOR_URL`

## Rodar à mão / testar
```bash
/root/backup/backup-supabase.sh          # backup agora
/root/backup/restore-test.sh             # restaura num DB descartável, confere linhas
```

## Restore de emergência
```bash
# 1. listar o que tem no R2
rclone lsf R2:atenna-db-backups/daily/
# 2. baixar
rclone copyto R2:atenna-db-backups/daily/<arquivo> /root/restore/<arquivo>
# 3. restaurar (confirma 2x, exige backup do alvo antes)
/root/backup/restore.sh /root/restore/<arquivo> \
  "host=db.<ref>.supabase.co port=5432 user=postgres dbname=postgres sslmode=require"
```

## Notas
- O `.dump` cru nunca toca o disco sem cifra (pipe `pg_dump | age`).
- Supabase Free não tem backup automático. Se migrar pro Pro, isto vira cópia offsite extra.
- Retenção: 14 diários + 8 semanais no R2; 3 locais.
