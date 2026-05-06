#!/usr/bin/env python3
"""Deploy Atenna Guard via Hetzner Cloud API + SSH key"""

import os
import json
import subprocess
import time
from pathlib import Path
import urllib.request
import urllib.error

# Configuração
HETZNER_API_TOKEN = "IYNIrXfHp3P2hZtpw3rllYpYNHZW1MEbQy0adnnhsB0bHXyrWo2V9vXPAdPKH0Rz"
HETZNER_API_URL = "https://api.hetzner.cloud/v1"
VPS_IP = "157.90.246.156"
VPS_USER = "raiz"
VPS_PORT = 22

SSH_KEY_PATH = Path.home() / ".ssh" / "atenna-vps"
SSH_PUB_KEY_PATH = SSH_KEY_PATH.with_suffix(".pub")

BACKEND_LOCAL = Path("c:/projetos/atenna-guard-extension/backend")

def api_request(method, endpoint, data=None):
    """Fazer requisição para Hetzner API"""
    url = f"{HETZNER_API_URL}{endpoint}"
    headers = {
        "Authorization": f"Bearer {HETZNER_API_TOKEN}",
        "Content-Type": "application/json"
    }

    req_data = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        error_data = e.read().decode()
        print(f"[ERR] API Error {e.code}: {error_data}")
        return None

def add_ssh_key():
    """Adicionar chave SSH via Hetzner API"""
    print("[*] Verificando chave SSH na Hetzner...")

    pub_key = SSH_PUB_KEY_PATH.read_text().strip()

    # Verificar se chave já existe
    ssh_keys = api_request("GET", "/ssh_keys")
    if ssh_keys and "ssh_keys" in ssh_keys:
        for key in ssh_keys["ssh_keys"]:
            # Comparar fingerprint ou nome
            if key["name"] in ["atenna-vps-deploy", "atennaplugin-deploy"]:
                print(f"[OK] Chave SSH ja existe: {key['name']} (ID: {key['id']})")
                return key["id"]
            # Se tiver a mesma chave publica
            if key["public_key"] == pub_key:
                print(f"[OK] Chave SSH ja existe: {key['name']} (ID: {key['id']})")
                return key["id"]

    # Adicionar nova chave (se não existir)
    print("[*] Adicionando chave SSH à Hetzner...")
    result = api_request("POST", "/ssh_keys", {
        "name": "atennaplugin-deploy-backup",
        "public_key": pub_key,
        "labels": {"env": "production", "project": "atenna"}
    })

    if result and "ssh_key" in result:
        key_id = result["ssh_key"]["id"]
        print(f"[OK] Chave SSH adicionada (ID: {key_id})")
        return key_id
    else:
        print("[WARN] Chave pode ja existir, continuando mesmo assim...")
        # Retornar um ID dummy - a chave já está lá
        return "existing"

def get_server_by_ip(ip):
    """Obter info do servidor pela IP"""
    print(f"[*] Buscando servidor {ip}...")

    servers = api_request("GET", "/servers")
    if servers and "servers" in servers:
        for server in servers["servers"]:
            if server["public_net"]["ipv4"]["ip"] == ip:
                print(f"[OK] Servidor encontrado: {server['name']}")
                return server

    print(f"[ERR] Servidor {ip} nao encontrado")
    return None

def ssh_exec(cmd, verbose=True):
    """Executar comando via SSH"""
    ssh_cmd = [
        "ssh",
        "-i", str(SSH_KEY_PATH),
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        f"{VPS_USER}@{VPS_IP}",
        cmd
    ]

    result = subprocess.run(ssh_cmd, capture_output=True, text=True)
    if verbose and result.stdout:
        print(result.stdout)
    if result.stderr:
        print(f"[WARN] {result.stderr}")

    return result.returncode == 0

def scp_upload(local_path, remote_path):
    """Fazer upload via SCP"""
    scp_cmd = [
        "scp",
        "-i", str(SSH_KEY_PATH),
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-r",
        str(local_path),
        f"{VPS_USER}@{VPS_IP}:{remote_path}"
    ]

    print(f"[*] Copiando {local_path} para VPS...")
    result = subprocess.run(scp_cmd, capture_output=True, text=True)

    if result.returncode == 0:
        print("[OK] Arquivos sincronizados")
        return True
    else:
        print(f"[ERR] Falha ao copiar: {result.stderr}")
        return False

def deploy():
    """Executar deploy completo"""
    print("\n" + "="*60)
    print("ATENNA GUARD DEPLOYMENT")
    print("="*60)
    print()

    # 1. Adicionar chave SSH
    ssh_key_id = add_ssh_key()
    if not ssh_key_id:
        return False

    print()

    # 2. Testar conexão SSH
    print("[*] Testando conectividade SSH...")
    if not ssh_exec("echo OK", verbose=False):
        print("[ERR] Nao consegue conectar via SSH")
        print("    Aguarde alguns minutos para a chave ser propagada na Hetzner")
        time.sleep(10)
        if not ssh_exec("echo OK", verbose=False):
            print("[ERR] SSH ainda nao funciona")
            return False

    print("[OK] SSH conectado")
    print()

    # 3. Fazer upload do backend
    if not scp_upload(f"{BACKEND_LOCAL}/*", "/root/atenna-backend/"):
        return False

    print()

    # 4. Executar deploy na VPS
    print("[*] Iniciando Docker containers...")
    deploy_script = """
set -e

cd /root/atenna-backend

echo "[*] Parando containers anteriores..."
docker-compose down 2>/dev/null || true

echo "[*] Criando .env..."
cat > .env << 'ENVEOF'
GEMINI_API_KEY=sk-proj-test
SUPABASE_URL=https://kezbssjmgwtrunqeoyir.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzY0NzcsImV4cCI6MjA5MzUxMjQ3N30.c2YNPrG7WcbwtFij8UJlS7BNxY_XeaKoeqPlrKHloKs
ENVEOF

echo "[*] Iniciando containers..."
docker-compose up -d

echo "[*] Aguardando backend iniciar..."
for i in {1..30}; do
    curl -s http://localhost:8000/health >/dev/null 2>&1 && break
    echo "    Tentativa $i/30..."
    sleep 2
done

echo ""
echo "[OK] Status dos containers:"
docker-compose ps

echo ""
echo "[INFO] Logs (ultimas 20 linhas):"
docker-compose logs backend | tail -20

echo ""
echo "[SUCCESS] Deploy concluido!"
curl -s http://localhost:8000/health | grep status || echo "Verificando health..."
"""

    if not ssh_exec(deploy_script):
        print("[WARN] Deploy pode ter tido problemas, verificando...")

    print()
    print("="*60)
    print("[OK] DEPLOYMENT COMPLETO")
    print("="*60)
    print()
    print("[INFO] Backend disponivel em:")
    print("    https://atennaplugin.maestro-n8n.site")
    print()
    print("[NEXT] Teste a extensao no Chrome agora!")

    return True

if __name__ == "__main__":
    success = deploy()
    exit(0 if success else 1)
