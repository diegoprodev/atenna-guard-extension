#!/usr/bin/env bash
# Deploy do backend na VPS — chamado pelo .github/workflows/deploy.yml via SSH.
# rsync já colocou o código novo em /root/atenna-backend/ (sem tocar em .env,
# data/, nginx/certs/, static/admin/). Aqui: rebuild → health check → rollback.
set -euo pipefail

cd /root/atenna-backend

echo "== imagem atual (para rollback) =="
PREV_IMG="$(docker inspect --format '{{.Image}}' atenna-backend-backend-1 2>/dev/null || true)"
echo "PREV_IMG=${PREV_IMG:-<nenhuma>}"

echo "== build + up =="
docker compose up -d --build backend

echo "== health check (até 60s) =="
ok=""
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health || echo 000)"
  if [ "$code" = "200" ]; then ok="1"; break; fi
  sleep 3
done

if [ -n "$ok" ]; then
  echo "DEPLOY OK — /health 200"
  # limpa imagens antigas soltas (mantém a atual e a de rollback implícita)
  docker image prune -f >/dev/null 2>&1 || true
  exit 0
fi

echo "!! HEALTH CHECK FALHOU — ROLLBACK"
if [ -n "$PREV_IMG" ]; then
  docker tag "$PREV_IMG" atenna-backend-backend:latest
  docker compose up -d --force-recreate backend
  sleep 8
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health || echo 000)"
  echo "pós-rollback /health = $code"
fi
exit 1
