#!/bin/bash

# Passo final: iniciar serviço e SSL

echo "=== Iniciando serviço Atenna ==="
systemctl start atenna
sleep 3
systemctl status atenna

echo "=== Verificando se backend está respondendo ==="
curl -s http://127.0.0.1:8000/health || echo "Backend ainda está iniciando..."

echo "=== Instalando certificado SSL ==="
certbot --nginx \
  --non-interactive \
  --agree-tos \
  --email devdiegopro@gmail.com \
  -d atennnaplugin.maestro-n8n.site

echo "=== ✅ VPS completamente configurada! ==="
echo "Backend rodando em: https://atennnaplugin.maestro-n8n.site"
