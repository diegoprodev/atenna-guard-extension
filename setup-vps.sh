#!/bin/bash

# Setup VPS Hetzner - Atenna Backend

set -e

echo "=== PASSO 1: Atualizar sistema ==="
apt update && apt upgrade -y

echo "=== PASSO 2: Instalar dependências ==="
apt install -y \
  python3 python3-pip python3-venv \
  nginx certbot python3-certbot-nginx \
  git curl wget ufw nano

echo "=== PASSO 3: Configurar firewall ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== PASSO 4: Criar diretório backend ==="
mkdir -p /root/atenna-backend
cd /root/atenna-backend

echo "=== PASSO 5: Criar venv e instalar deps Python ==="
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install fastapi uvicorn pydantic httpx python-dotenv google-generativeai

echo "=== PASSO 6: Criar serviço systemd ==="
cat > /etc/systemd/system/atenna.service << 'EOF'
[Unit]
Description=Atenna FastAPI Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/atenna-backend
Environment="PATH=/root/atenna-backend/venv/bin"
ExecStart=/root/atenna-backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable atenna

echo "=== PASSO 7: Configurar Nginx ==="
cat > /etc/nginx/sites-available/atenna << 'EOF'
server {
    listen 80;
    server_name atennnaplugin.maestro-n8n.site;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/atenna /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

echo "=== ✅ VPS configurada! ==="
echo "Próximos passos:"
echo "1. Copiar backend com: scp -r backend raiz@157.90.246.156:/root/"
echo "2. SSH e ativar serviço: systemctl start atenna"
echo "3. Certificado SSL: certbot --nginx -d atennnaplugin.maestro-n8n.site"
