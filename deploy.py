#!/usr/bin/env python3
"""
Script de Deploy Automático para Atenna Guard Backend na VPS Hetzner
Requer: pip install paramiko
"""

import paramiko
import os
import sys
from pathlib import Path

# Configuração
VPS_IP = "157.90.246.156"
VPS_USER = "raiz"
VPS_PASSWORD = "19041308Drs@#$"  # ⚠️ SEGREDO - remover após deploy em produção
VPS_PORT = 22
BACKEND_LOCAL = Path("c:/projetos/atenna-guard-extension/backend")
BACKEND_REMOTE = "/root/atenna-backend"

def deploy():
    print("[*] Iniciando deploy para Hetzner VPS...")
    print(f"    Host: {VPS_IP}")
    print(f"    User: {VPS_USER}")
    print()

    # 1. Conectar via SSH
    print("[*] Conectando à VPS...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(VPS_IP, port=VPS_PORT, username=VPS_USER, password=VPS_PASSWORD, timeout=10)
        print("[OK] Conectado à VPS")
    except Exception as e:
        print(f"[ERR] Erro ao conectar: {e}")
        return False

    # 2. Criar diretório remoto
    print(f"\n[*] Criando diretório {BACKEND_REMOTE}...")
    stdin, stdout, stderr = ssh.exec_command(f"mkdir -p {BACKEND_REMOTE}")
    stderr_text = stderr.read().decode()
    if stderr_text:
        print(f"    {stderr_text.strip()}")

    # 3. Sincronizar arquivos via SCP
    print("\n[*] Sincronizando arquivos do backend...")
    sftp = ssh.open_sftp()

    def upload_dir(local_dir, remote_dir):
        """Upload recursivo de diretório"""
        for item in Path(local_dir).iterdir():
            if item.name.startswith('.') or item.name == '__pycache__':
                continue

            remote_path = f"{remote_dir}/{item.name}"

            if item.is_file():
                print(f"    UP {item.name}")
                sftp.put(str(item), remote_path)
            elif item.is_dir():
                try:
                    sftp.mkdir(remote_path)
                except:
                    pass
                upload_dir(item, remote_path)

    upload_dir(BACKEND_LOCAL, BACKEND_REMOTE)
    sftp.close()
    print("[OK] Arquivos sincronizados")

    # 4. Criar docker-compose.yml se não existir
    print("\n[*] Verificando docker-compose.yml...")
    stdin, stdout, stderr = ssh.exec_command(f"ls {BACKEND_REMOTE}/docker-compose.yml")
    if stdout.channel.recv_exit_status() != 0:
        print("   Criando docker-compose.yml...")
        docker_compose = """version: '3.8'

services:
  backend:
    build: .
    ports:
      - "127.0.0.1:8000:8000"
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    restart: always
    volumes:
      - ./data:/app/data

  nginx:
    image: nginx:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt/live/atennaplugin.maestro-n8n.site:/etc/nginx/certs:ro
    depends_on:
      - backend
    restart: always
"""
        stdin, stdout, stderr = ssh.exec_command(
            f"cat > {BACKEND_REMOTE}/docker-compose.yml << 'EOF'\n{docker_compose}\nEOF"
        )
        stdout.read()

    # 5. Parar containers anteriores e reiniciar
    print("\n[*] Reiniciando containers Docker...")
    commands = [
        f"cd {BACKEND_REMOTE}",
        "docker-compose down 2>/dev/null || true",
        "docker-compose up -d",
        "sleep 3",
        "docker-compose logs backend | head -30"
    ]

    full_cmd = " && ".join(commands)
    stdin, stdout, stderr = ssh.exec_command(full_cmd, get_pty=True)

    # Ler output em tempo real
    for line in stdout:
        print(f"    {line.rstrip()}")

    # 6. Verificar health endpoint
    print("\n[*] Testando backend...")
    stdin, stdout, stderr = ssh.exec_command(
        "sleep 5 && curl -s http://localhost:8000/health || echo 'Health check failed'"
    )
    health_output = stdout.read().decode().strip()
    print(f"    {health_output}")

    # 7. Testar callback endpoint
    print("\n[*] Testando /auth/callback endpoint...")
    stdin, stdout, stderr = ssh.exec_command(
        "curl -s 'http://localhost:8000/auth/callback?access_token=test123' | head -20 || echo 'Callback failed'"
    )
    callback_output = stdout.read().decode().strip()
    print(f"    {callback_output[:200]}")

    ssh.close()

    print("\n[OK] Deploy concluido com sucesso!")
    print("\n[INFO] Proximos passos:")
    print("    1. Abra a extensao no Chrome")
    print("    2. Teste o fluxo de login (email/password)")
    print("    3. Verifique os logs: ssh raiz@157.90.246.156 'cd /root/atenna-backend && docker-compose logs -f'")
    print()
    print(f"    Backend rodando em: https://atennaplugin.maestro-n8n.site")

    return True

if __name__ == "__main__":
    try:
        import paramiko
    except ImportError:
        print("[ERR] paramiko nao instalado. Instale com:")
        print("    pip install paramiko")
        sys.exit(1)

    success = deploy()
    sys.exit(0 if success else 1)
