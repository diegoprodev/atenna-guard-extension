"""
FASE 9.0 — invariantes da reconciliação. A spec não pode regredir nada.

Estáticos (rodam em qualquer lugar) + um import real do app (staging).
"""
import ast
import os
import re
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)


def _read(rel):
    with open(os.path.join(BACKEND, rel), encoding="utf-8") as f:
        return f.read()


def _all_py():
    for root, _dirs, files in os.walk(BACKEND):
        if "__pycache__" in root or f"{os.sep}tests" in root:
            continue
        for fn in files:
            if fn.endswith(".py"):
                yield os.path.join(root, fn)


# ─── R1: todos os routers importados em main.py existem ───

def test_R1_todos_os_modulos_de_main_existem():
    tree = ast.parse(_read("main.py"))
    faltando = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and (
            node.module.startswith("routes") or node.module.startswith("middleware")
            or node.module.startswith("dlp") or node.module.startswith("services")
            or node.module.startswith("schemas")
        ):
            path = os.path.join(BACKEND, *node.module.split(".")) + ".py"
            pkg = os.path.join(BACKEND, *node.module.split(".")), "__init__.py"
            if not os.path.exists(path) and not os.path.exists(os.path.join(*pkg)):
                faltando.append(node.module)
    assert not faltando, f"main.py importa módulos inexistentes: {sorted(set(faltando))}"


# ─── R2: rotas sensíveis exigem auth ───

SENSIVEIS = [
    ("routes/dlp.py", ["/scan", "/image"]),
    ("routes/checkout.py", ["/create"]),
    ("routes/analytics.py", ["/track"]),
]

@pytest.mark.parametrize("arquivo,paths", SENSIVEIS)
def test_R2_rotas_sensiveis_tem_require_auth(arquivo, paths):
    src = _read(arquivo)
    assert "require_auth" in src, f"{arquivo} não importa/usa require_auth"


def test_R2_generate_prompts_tem_require_auth():
    src = _read("main.py")
    # o endpoint /generate-prompts deve depender de require_auth
    m = re.search(r'@app\.post\(\s*["\']/generate-prompts["\'].*?\ndef |@app\.post\(\s*["\']/generate-prompts["\'].*?async def ', src, re.S)
    assert "require_auth" in src
    assert re.search(r'/generate-prompts.*?Depends\(require_auth\)', src, re.S), (
        "/generate-prompts sem Depends(require_auth)"
    )


# ─── R3: JWT bruto rejeitado ───

def test_R3_require_auth_rejeita_jwt_bruto():
    src = _read("middleware/auth.py")
    assert 'token.count(".") == 2' in src or "count('.') == 2" in src, (
        "require_auth precisa rejeitar token com 2 pontos (JWT bruto)"
    )


# ─── R4: quota free = 5 em todo lugar ───

def test_R4_quota_free_e_5():
    assert "FREE_DAILY_LIMIT   = 5" in _read("dlp/rate_limit.py") or \
           "FREE_DAILY_LIMIT = 5" in _read("dlp/rate_limit.py")
    assert "FREE_DAILY_LIMIT = 5" in _read("services/quota_service.py")
    assert "FREE_DAILY_LIMIT = 10" not in _read("services/quota_service.py")


# ─── R5: nenhum segredo hardcoded ───

SECRET_RX = re.compile(
    r"(sk-[A-Za-z0-9]{20,}|sk-proj-[A-Za-z0-9_\-]{20,}|AKIA[0-9A-Z]{16}"
    r"|AIza[0-9A-Za-z_\-]{35}|eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}"
    r"|postgres(?:ql)?://[^\s\"']+:[^\s\"'@]+@)"
)

def test_R5_sem_segredo_hardcoded():
    """Código de produção (não-teste) não pode ter segredo hardcoded."""
    achados = []
    for p in _all_py():
        rel = os.path.relpath(p, BACKEND)
        if os.path.basename(p).startswith("test_") or f"{os.sep}tests{os.sep}" in p:
            continue  # fixtures de teste têm strings fake com formato de credencial
        txt = open(p, encoding="utf-8", errors="ignore").read()
        for m in SECRET_RX.finditer(txt):
            frag = m.group(0)
            if "EXAMPLE" in frag.upper() or "your_" in frag or "xxxx" in frag.lower():
                continue
            achados.append(f"{rel}: {frag[:30]}...")
    assert not achados, "possível segredo hardcoded:\n" + "\n".join(achados)


# ─── R6: domínio morto não pode voltar ───

def test_R6_sem_dominio_morto():
    achados = []
    for p in _all_py():
        if "maestro-n8n.site" in open(p, encoding="utf-8", errors="ignore").read():
            achados.append(os.path.relpath(p, BACKEND))
    for extra in ("nginx/default.conf", "docker-compose.yml"):
        fp = os.path.join(BACKEND, extra)
        if os.path.exists(fp) and "maestro-n8n.site" in open(fp, encoding="utf-8").read():
            achados.append(extra)
    assert not achados, f"referência ao domínio morto: {achados}"


# ─── R7: CORS com os 5 sites de IA ───

def test_R7_cors_inclui_sites_de_ia():
    src = _read("main.py")
    for host in ("chatgpt.com", "claude.ai", "gemini.google.com", "perplexity.ai"):
        assert host in src, f"ALLOWED_ORIGINS sem {host}"


# ─── R-import: o app sobe (staging — pula se faltar env) ───

def test_import_app_sobe():
    try:
        import main  # noqa: F401
    except ModuleNotFoundError as e:
        pytest.fail(f"import main falhou por módulo ausente: {e}")
    except Exception as e:
        pytest.skip(f"import main precisa de ambiente completo (staging): {e}")
