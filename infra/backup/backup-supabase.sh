#!/usr/bin/env bash
# Backup diário do Postgres do Supabase.
#   pg_dump (via IPv6, direto do host da VPS)  →  age (cifra)  →  cópia local + Cloudflare R2
#   →  poda de retenção  →  check-in no GlitchTip (alerta no Discord se não rodar).
#
# Config em /root/backup/.env (NÃO versionado):
#   SUPABASE_DB_HOST=db.<ref>.supabase.co
#   SUPABASE_DB_PASSWORD=...
#   AGE_RECIPIENT=age1...            # chave PÚBLICA age (cifra)
#   R2_ACCESS_KEY_ID=...
#   R2_SECRET_ACCESS_KEY=...
#   R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
#   R2_BUCKET=atenna-db-backups
#   GLITCHTIP_MONITOR_URL=          # opcional: URL de check-in do cron monitor
set -euo pipefail

CONF="${BACKUP_ENV:-/root/backup/.env}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && set -a && . "$CONF" && set +a

: "${SUPABASE_DB_HOST:?}" "${SUPABASE_DB_PASSWORD:?}" "${AGE_RECIPIENT:?}"

LOCAL_DIR="${LOCAL_DIR:-/root/backups}"
KEEP_LOCAL="${KEEP_LOCAL:-3}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="atenna-db-${TS}.dump.age"
LOCAL_PATH="${LOCAL_DIR}/${NAME}"
mkdir -p "$LOCAL_DIR"

fail() { echo "BACKUP FALHOU: $*" >&2; exit 1; }

echo "[$(date -u +%FT%TZ)] pg_dump ${SUPABASE_DB_HOST} → age → ${NAME}"

# pipe direto: o .dump cru NUNCA toca o disco sem cifra
PGPASSWORD="$SUPABASE_DB_PASSWORD" PGCONNECT_TIMEOUT=20 \
  pg_dump \
    "host=${SUPABASE_DB_HOST} port=5432 user=postgres dbname=postgres sslmode=require" \
    --format=custom --no-owner --no-privileges --compress=9 \
  | age -r "$AGE_RECIPIENT" -o "$LOCAL_PATH" \
  || fail "pg_dump | age"

SIZE="$(stat -c %s "$LOCAL_PATH")"
[ "$SIZE" -gt 1000 ] || fail "dump muito pequeno (${SIZE} bytes)"
echo "local ok: ${LOCAL_PATH} (${SIZE} bytes)"

# ── Cloudflare R2 (via rclone) ────────────────────────────────────────────────
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_ENDPOINT:-}" ]; then
  export RCLONE_CONFIG=/dev/null
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
  export RCLONE_CONFIG_R2_ACL=private
  DEST="R2:${R2_BUCKET}/daily/${NAME}"
  rclone copyto "$LOCAL_PATH" "$DEST" --s3-no-check-bucket || fail "rclone copy R2"
  echo "R2 ok: ${DEST}"

  # domingo: promove p/ semanal
  if [ "$(date -u +%u)" = "7" ]; then
    rclone copyto "$LOCAL_PATH" "R2:${R2_BUCKET}/weekly/${NAME}" --s3-no-check-bucket || true
  fi
  # poda: 14 diários, 8 semanais
  prune() {
    local pfx="$1" keep="$2"
    rclone lsf "R2:${R2_BUCKET}/${pfx}/" 2>/dev/null | sort | head -n "-${keep}" \
      | while read -r f; do [ -n "$f" ] && rclone deletefile "R2:${R2_BUCKET}/${pfx}/${f}" || true; done
  }
  prune daily 14
  prune weekly 8
else
  echo "R2 não configurado — só cópia local"
fi

# poda local
ls -1t "${LOCAL_DIR}"/atenna-db-*.dump.age 2>/dev/null | tail -n "+$((KEEP_LOCAL+1))" \
  | xargs -r rm -f

# ── check-in GlitchTip (cron monitor) ────────────────────────────────────────
if [ -n "${GLITCHTIP_MONITOR_URL:-}" ]; then
  curl -fsS -m 10 -X POST "$GLITCHTIP_MONITOR_URL" >/dev/null 2>&1 || echo "aviso: check-in GlitchTip falhou"
fi

echo "[$(date -u +%FT%TZ)] BACKUP OK"
