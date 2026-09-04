"""
FASE P-ZT — guard anti-IDOR.

IDOR = trocar um ID no request pra acessar dado de outro usuário.

Regra: nenhuma rota de dado de usuário comum pode FILTRAR uma query de banco por
um `user_id` que veio do CLIENTE (Query/Path param, ou campo do body Pydantic).
O `user_id` de filtro tem que vir do token (`_user[...]` / `session[...]`).
Rotas /admin/* podem receber user_id (é o propósito) desde que gated.
"""
import re
from pathlib import Path

ROUTES_DIR = Path(__file__).resolve().parent.parent / "routes"

# Rotas onde receber user_id do cliente é intencional (admin com gate, ou jobs).
ALLOWLIST = {
    "admin/compliance.py", "admin/plans.py", "admin/users.py", "admin/subscriptions.py",
    "admin/dlp.py", "admin/overview.py", "admin/usage.py", "admin/costs.py",
    "admin/audit.py", "admin/errors.py", "admin/feature_flags.py", "admin/system.py",
    "admin/uninstall_feedback.py", "retention.py",
}


def _route_files():
    for p in ROUTES_DIR.rglob("*.py"):
        if p.name != "__init__.py":
            yield p


def test_no_db_filter_by_client_user_id():
    """
    Falha se uma rota faz `.eq("user_id", X)` onde X é um param de Query/Path
    ou um atributo de `request.`/`body.`/`payload.` (= veio do cliente).
    """
    # .eq("user_id", <alvo>)  /  .eq('user_id', <alvo>)
    eq_filter = re.compile(r"""\.eq\(\s*["']user_id["']\s*,\s*([A-Za-z_][\w.]*)\s*\)""")
    # nomes de params que vêm do cliente (Query/Path) — coletados por arquivo
    client_param = re.compile(r"(\w+)\s*(?::\s*[\w\[\], ]+)?\s*=\s*(?:Query|Path)\(")

    offenders = []
    for path in _route_files():
        rel = path.relative_to(ROUTES_DIR).as_posix()
        if rel in ALLOWLIST:
            continue
        src = path.read_text(encoding="utf-8", errors="ignore")
        client_names = set(client_param.findall(src))
        for m in eq_filter.finditer(src):
            target = m.group(1)
            line = src[: m.start()].count("\n") + 1
            base = target.split(".")[0]
            if base in client_names or target.startswith(("request.", "body.", "payload.", "req.")):
                offenders.append(f"{rel}:{line}  →  .eq('user_id', {target})")

    assert not offenders, (
        "Query de banco filtrada por user_id vindo do cliente (IDOR). "
        "Use _user['user_id']/session['user_id'], ou adicione ao ALLOWLIST se for admin:\n  "
        + "\n  ".join(offenders)
    )


def test_user_routes_require_auth():
    """
    Todo handler de rota com prefix /user exige Depends(require_auth) — exceto:
      - landings de e-mail (GET /confirm, /download-file): token de 32 bytes no
        lugar de sessão, é o mesmo padrão do reset de senha (/auth/callback)
      - GET /deletion/lifecycle: conteúdo estático público (explica os estados)
      - rotas gated por Depends(require_super_admin) em vez de require_auth
        (achado do guard: /export/purge e /export/summary não tinham NENHUM
        auth — corrigido pra admin nesta mesma fase)
    """
    auth_dep = re.compile(r"Depends\(\s*(require_auth|require_super_admin)\s*\)")
    # rotas token-based ou públicas por design — o nome da função identifica.
    TOKEN_OR_PUBLIC = ("confirm", "download_file", "lifecycle")
    missing = []
    for path in _route_files():
        src = path.read_text(encoding="utf-8", errors="ignore")
        if 'prefix="/user' not in src:
            continue
        parts = re.split(r"@router\.(get|post|patch|put|delete)\(", src)
        for i in range(1, len(parts), 2):
            verb, block = parts[i], parts[i + 1]
            head = block[:700]
            fn = re.search(r"def\s+(\w+)", head)
            fn_name = fn.group(1) if fn else ""
            if any(tok in fn_name for tok in TOKEN_OR_PUBLIC):
                continue
            if not auth_dep.search(head):
                missing.append(f"{path.name}:{verb} {fn_name or '?'}")
    assert not missing, f"Rotas /user/* sem require_auth/require_super_admin: {missing}"
