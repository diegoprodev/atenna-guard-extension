#!/usr/bin/env python3
"""Fix docker-compose.yml e subir containers"""

import time
import paramiko
from paramiko import SSHClient, AutoAddPolicy

VPS_IP   = "157.90.246.156"
VPS_USER = "root"
VPS_PASS = "19041308Drs@#$"
DOMAIN   = "atennaplugin.maestro-n8n.site"


def connect():
    ssh = SSHClient()
    ssh.set_missing_host_key_policy(AutoAddPolicy())
    ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=10)
    return ssh


def run(ssh, cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=180)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.strip().encode("ascii", errors="replace").decode())
    if err.strip() and "WARNING" not in err and "debconf" not in err:
        print(f"  WARN: {err.strip()[:400].encode('ascii', errors='replace').decode()}")
    return code == 0


def main():
    print("[*] Conectando...")
    ssh = connect()
    print("[OK] Conectado!")

    # Criar docker-compose.yml correto
    print("\n[*] Criando docker-compose.yml...")
    compose_content = f"""version: '3.8'

services:
  backend:
    build: .
    ports:
      - "127.0.0.1:8000:8000"
    env_file: .env
    restart: always
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - atenna

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - backend
    restart: always
    networks:
      - atenna

networks:
  atenna:
    driver: bridge
"""
    # Usar sftp para criar o arquivo diretamente (evita problemas de escaping)
    sftp = ssh.open_sftp()
    with sftp.open("/root/atenna-backend/docker-compose.yml", "w") as f:
        f.write(compose_content)
    print("[OK] docker-compose.yml criado")

    # Criar nginx config
    nginx_content = f"""server {{
    listen 80;
    server_name {DOMAIN};
    location /.well-known/acme-challenge/ {{
        root /var/www/certbot;
    }}
    location / {{
        return 301 https://$host$request_uri;
    }}
}}

server {{
    listen 443 ssl http2;
    server_name {DOMAIN};

    ssl_certificate /etc/letsencrypt/live/{DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {{
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }}
}}
"""
    run(ssh, "mkdir -p /root/atenna-backend/nginx")
    with sftp.open("/root/atenna-backend/nginx/default.conf", "w") as f:
        f.write(nginx_content)
    sftp.close()
    print("[OK] nginx/default.conf criado")

    # Verificar .env
    print("\n[*] Verificando .env...")
    run(ssh, "cat /root/atenna-backend/.env | head -3")

    # Listar arquivos
    print("\n[*] Arquivos em /root/atenna-backend:")
    run(ssh, "ls -la /root/atenna-backend/")

    # Build e subir containers
    print("\n[*] Build do container backend...")
    run(ssh, "cd /root/atenna-backend && docker compose build --no-cache 2>&1")

    print("\n[*] Subindo containers...")
    run(ssh, "cd /root/atenna-backend && docker compose up -d 2>&1")

    # Aguardar
    print("\n[*] Aguardando backend iniciar (60s)...")
    for i in range(15):
        time.sleep(4)
        ok = run(ssh, "curl -sf http://localhost:8000/health")
        if ok:
            print("[OK] Backend respondendo!")
            break
        print(f"  {(i+1)*4}s...")

    # Status
    print("\n[*] Status dos containers:")
    run(ssh, "cd /root/atenna-backend && docker compose ps")

    print("\n[*] Logs backend (ultimas 30 linhas):")
    run(ssh, "cd /root/atenna-backend && docker compose logs backend | tail -30")

    # Testar externamente
    print("\n[*] Teste HTTPS externo:")
    run(ssh, f"curl -sf https://{DOMAIN}/health && echo OK || echo 'Aguardando...'")

    print(f"""
=== DEPLOY COMPLETO ===
Backend:   https://{DOMAIN}
Health:    https://{DOMAIN}/health
Auth CB:   https://{DOMAIN}/auth/callback

SSH:  ssh -i ~/.ssh/atenna-vps root@{VPS_IP}
Logs: ssh root@{VPS_IP} 'cd /root/atenna-backend && docker compose logs -f'
""")
    ssh.close()


if __name__ == "__main__":
    main()
