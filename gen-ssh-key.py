#!/usr/bin/env python3
"""Gera chave SSH para Hetzner VPS"""

import os
import subprocess
from pathlib import Path

ssh_dir = Path(os.path.expanduser("~/.ssh"))
ssh_dir.mkdir(exist_ok=True)

key_path = ssh_dir / "atenna-vps"

# Verificar se chave já existe
if key_path.exists():
    print("[OK] Chave SSH ja existe")
    pub_key = (key_path.with_suffix(".pub")).read_text().strip()
    print()
    print(pub_key)
    print()
    exit(0)

# Gerar chave
print("[*] Gerando chave SSH...")
result = subprocess.run([
    "ssh-keygen",
    "-t", "ed25519",
    "-f", str(key_path),
    "-N", "",  # passphrase vazia
    "-C", "atenna-vps-deploy"
], capture_output=True, text=True)

if result.returncode != 0:
    print("[ERR] Erro ao gerar chave:")
    print(result.stderr)
    exit(1)

print("[OK] Chave gerada")

# Ler chave pública
pub_key = (key_path.with_suffix(".pub")).read_text().strip()

print()
print("[*] Chave publica (OpenSSH format):")
print()
print(pub_key)
print()
print("[ACTION] Cole esta chave na Hetzner Cloud > SSH Keys > Add SSH key")
print()
print("[INFO] Chave privada salva em:", str(key_path))
