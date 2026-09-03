#!/usr/bin/env bash
# Teste de restauração mensal. Baixa o backup mais recente, decifra, restaura num
# schema/DB descartável e confere que tem dados. Backup não testado = sem backup.
#
# Precisa da chave PRIVADA age em /root/backup/age-key.txt (600) — só neste host,
# para o teste. Em emergência o dono usa a cópia do cofre dele.
set -euo pipefail

CONF="${BACKUP_ENV:-/root/backup/.env}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && set -a && . "$CONF" && set +a

AGE_KEY="${AGE_KEY:-/root/backup/age-key.txt}"
LOCAL_DIR="${LOCAL_DIR:-/root/backups}"
[ -f "$AGE_KEY" ] || { echo "sem chave age privada em $AGE_KEY — teste pulado"; exit 0; }

LATEST="$(ls -1t "${LOCAL_DIR}"/atenna-db-*.dump.age 2>/dev/null | head -1)"
[ -n "$LATEST" ] || { echo "nenhum backup local"; exit 1; }
echo "testando: $LATEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
age -d -i "$AGE_KEY" -o "${TMP}/db.dump" "$LATEST"

# lista o conteúdo (não restaura ainda) — falha se o dump estiver corrompido
pg_restore -l "${TMP}/db.dump" >/dev/null || { echo "dump CORROMPIDO"; exit 1; }

# restaura num DB local descartável (Docker do GlitchTip tem um Postgres)
GT_PG="glitchtip-postgres-1"
docker exec "$GT_PG" psql -U postgres -c "DROP DATABASE IF EXISTS restore_test;" >/dev/null
docker exec "$GT_PG" psql -U postgres -c "CREATE DATABASE restore_test;" >/dev/null
docker exec -i "$GT_PG" pg_restore -U postgres -d restore_test --no-owner --no-privileges < "${TMP}/db.dump" \
  2>/dev/null || true   # warnings de extensão são esperados

ROWS="$(docker exec "$GT_PG" psql -U postgres -d restore_test -tAc \
  "SELECT coalesce((SELECT count(*) FROM profiles),0);" 2>/dev/null || echo 0)"
docker exec "$GT_PG" psql -U postgres -c "DROP DATABASE restore_test;" >/dev/null

if [ "${ROWS:-0}" -ge 1 ]; then
  echo "RESTORE TEST OK — profiles: ${ROWS} linhas"
  [ -n "${GLITCHTIP_RESTORE_MONITOR_URL:-}" ] && curl -fsS -m 10 "$GLITCHTIP_RESTORE_MONITOR_URL" >/dev/null 2>&1 || true
else
  echo "RESTORE TEST FALHOU — profiles vazio"
  exit 1
fi
