#!/usr/bin/env bash
# RESTORE DE EMERGÊNCIA — restaura um backup POR CIMA de um banco alvo.
# Uso:  ./restore.sh <arquivo.dump.age> "host=... port=5432 user=postgres dbname=postgres sslmode=require"
#
# Confirma DUAS vezes. Isto SOBRESCREVE dados. Tenha certeza do alvo.
set -euo pipefail

FILE="${1:?arquivo .dump.age}"
TARGET="${2:?connection string do alvo}"
AGE_KEY="${AGE_KEY:-/root/backup/age-key.txt}"

[ -f "$FILE" ]    || { echo "arquivo não existe: $FILE"; exit 1; }
[ -f "$AGE_KEY" ] || { echo "sem chave age privada em $AGE_KEY"; exit 1; }

echo "!! RESTORE — vai sobrescrever objetos no alvo:"
echo "   $TARGET"
echo "   fonte: $FILE"
read -r -p "digite RESTAURAR para continuar: " a; [ "$a" = "RESTAURAR" ] || exit 1
read -r -p "tem backup do ESTADO ATUAL do alvo? (sim/nao): " b; [ "$b" = "sim" ] || { echo "faça um backup do alvo primeiro (backup-supabase.sh)"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
age -d -i "$AGE_KEY" -o "${TMP}/db.dump" "$FILE"
pg_restore -l "${TMP}/db.dump" >/dev/null || { echo "dump corrompido"; exit 1; }

PGCONNECT_TIMEOUT=20 pg_restore --verbose --no-owner --no-privileges \
  --clean --if-exists --dbname="$TARGET" "${TMP}/db.dump"

echo "RESTORE concluído."
