#!/usr/bin/env python3
"""Setup completo da VPS Atenna Guard"""

import os
import time
import subprocess
from pathlib import Path
import paramiko
from paramiko import SSHClient, AutoAddPolicy

VPS_IP   = "157.90.246.156"
VPS_USER = "root"
VPS_PASS = "19041308Drs@#$"

SSH_KEY_LOCAL  = Path.home() / ".ssh" / "atenna-vps"
BACKEND_LOCAL  = Path("c:/projetos/atenna-guard-extension/backend")

DOMAIN = "atennaplugin.maestro-n8n.site"


def connect(use_key=False):
    ssh = SSHClient()
    ssh.set_missing_host_key_policy(AutoAddPolicy())
    try:
        if use_key and SSH_KEY_LOCAL.exists():
            ssh.connect(VPS_IP, username=VPS_USER, key_filename=str(SSH_KEY_LOCAL), timeout=10)
        else:
            ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=10)
        return ssh
    except Exception as e:
        print(f"[ERR] {e}")
        return None


def run(ssh, cmd, check=False):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.strip().encode("ascii", errors="replace").decode())
    if err.strip() and "WARNING" not in err:
        print(f"  ERR: {err.strip()[:300].encode('ascii', errors='replace').decode()}")
    return code == 0


def upload(ssh, local_dir, remote_dir):
    sftp = ssh.open_sftp()

    def mkdirp(path):
        try: sftp.mkdir(path)
        except: pass

    def put_dir(ldir, rdir):
        mkdirp(rdir)
        for item in Path(ldir).iterdir():
            if item.name in ["__pycache__", ".env"]:
                continue
            rpath = f"{rdir}/{item.name}"
            if item.is_file():
                sftp.put(str(item), rpath)
            elif item.is_dir():
                put_dir(item, rpath)

    print(f"[*] Upload {local_dir} -> {remote_dir}")
    put_dir(local_dir, remote_dir)
    sftp.close()
    print("[OK] Upload concluido")


def setup():
    print("\n=== ATENNA VPS SETUP ===\n")

    # 1. Conectar
    print("[*] Conectando via senha...")
    ssh = connect(use_key=False)
    if not ssh:
        print("[*] Tentando via chave SSH...")
        ssh = connect(use_key=True)
    if not ssh:
        print("[ERR] Nao consegue conectar!")
        return False
    print("[OK] Conectado!")

    # 2. Adicionar chave SSH para futuros acessos
    if SSH_KEY_LOCAL.exists():
        pub = SSH_KEY_LOCAL.with_suffix(".pub").read_text().strip()
        run(ssh, f'mkdir -p ~/.ssh && echo "{pub}" >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys')
        print("[OK] Chave SSH adicionada ao servidor")

    # 3. Atualizar sistema
    print("\n[*] Atualizando sistema...")
    run(ssh, "DEBIAN_FRONTEND=noninteractive apt-get update -qq")
    run(ssh, "DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq -o Dpkg::Options::='--force-confdef' -o Dpkg::Options::='--force-confold'")
    run(ssh, "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl wget git ufw fail2ban")

    # 4. Instalar Docker
    print("\n[*] Instalando Docker...")
    run(ssh, "which docker || (curl -fsSL https://get.docker.com | sh)")
    # docker compose via plugin (novo padrão)
    run(ssh, "docker compose version || apt-get install -y -qq docker compose-v2 2>/dev/null || true")
    run(ssh, "docker --version && docker compose version")

    # 5. Instalar Certbot
    print("\n[*] Instalando Certbot...")
    run(ssh, "apt-get install -y -qq certbot")

    # 6. Configurar Firewall UFW
    print("\n[*] Configurando UFW...")
    run(ssh, "ufw --force disable")  # reset primeiro
    run(ssh, "ufw default deny incoming")
    run(ssh, "ufw default allow outgoing")
    run(ssh, "ufw allow 22/tcp comment 'SSH'")
    run(ssh, "ufw allow 80/tcp comment 'HTTP'")
    run(ssh, "ufw allow 443/tcp comment 'HTTPS'")
    run(ssh, "ufw --force enable")
    run(ssh, "ufw status verbose")

    # 7. Configurar fail2ban
    print("\n[*] Configurando fail2ban...")
    run(ssh, """cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled  = true
port     = ssh
maxretry = 5
bantime  = 3600
findtime = 600
EOF""")
    run(ssh, "systemctl enable fail2ban && systemctl restart fail2ban")

    # 8. Upload do backend
    print("\n[*] Fazendo upload do backend...")
    run(ssh, "mkdir -p /root/atenna-backend/nginx /root/atenna-backend/data")
    upload(ssh, BACKEND_LOCAL, "/root/atenna-backend")

    # 9. Criar .env na VPS (lendo do arquivo local)
    env_local = BACKEND_LOCAL / ".env"
    if env_local.exists():
        env_content = env_local.read_text()
        run(ssh, f"cat > /root/atenna-backend/.env << 'ENVEOF'\n{env_content}\nENVEOF")
        print("[OK] .env criado")

    # 10. Criar docker compose.yml
    print("\n[*] Criando docker compose.yml...")
    run(ssh, """cat > /root/atenna-backend/docker compose.yml << 'EOF'
version: '3.8'

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
EOF""")

    # 11. Criar nginx config
    run(ssh, f"""cat > /root/atenna-backend/nginx/default.conf << 'EOF'
server {{
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
    add_header X-XSS-Protection "1; mode=block";

    location / {{
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }}
}}
EOF""")

    # 12. Parar nginx local se rodando
    run(ssh, "systemctl stop nginx 2>/dev/null || true")

    # 13. Obter certificado SSL
    print(f"\n[*] Obtendo SSL para {DOMAIN}...")
    ssl_ok = run(ssh, f"certbot certonly --standalone -d {DOMAIN} --non-interactive --agree-tos --email devdiegopro@gmail.com")
    if ssl_ok:
        print("[OK] SSL obtido!")
    else:
        print("[WARN] SSL falhou — vai rodar sem HTTPS por agora")

    # 14. Build e iniciar containers
    print("\n[*] Buildando e iniciando containers...")
    run(ssh, "cd /root/atenna-backend && docker compose down 2>/dev/null || true")
    run(ssh, "cd /root/atenna-backend && docker compose build --no-cache", check=False)
    run(ssh, "cd /root/atenna-backend && docker compose up -d")

    # 15. Aguardar e testar
    print("\n[*] Aguardando backend iniciar...")
    for i in range(15):
        time.sleep(4)
        ok = run(ssh, "curl -sf http://localhost:8000/health", check=False)
        if ok:
            print("[OK] Backend respondendo!")
            break
        print(f"  Tentativa {i+1}/15...")

    # 16. Status final
    print("\n[*] Status final:")
    run(ssh, "cd /root/atenna-backend && docker compose ps")
    run(ssh, "cd /root/atenna-backend && docker compose logs backend | tail -20")

    # 17. Testar HTTPS
    print("\n[*] Testando HTTPS...")
    run(ssh, f"curl -sf https://{DOMAIN}/health || echo 'HTTPS ainda propagando'")

    print("\n=== SETUP CONCLUIDO ===")
    print(f"Backend: https://{DOMAIN}")
    print(f"Health:  https://{DOMAIN}/health")
    print(f"Logs:    ssh -i ~/.ssh/atenna-vps root@{VPS_IP} 'cd /root/atenna-backend && docker compose logs -f'")

    ssh.close()
    return True


if __name__ == "__main__":
    setup()
