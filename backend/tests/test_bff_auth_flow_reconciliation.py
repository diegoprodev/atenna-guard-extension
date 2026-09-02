"""
FASE 9.0 — fluxo de auth do BFF.

Bugs pré-existentes achados na validação E2E:
- login dava 500: `sign_in_with_password` no cliente admin compartilhado trocava o
  Authorization para o JWT do usuário → o INSERT em bff_sessions batia em RLS.
- /auth/signup não existia (front chama, backend 404) → ninguém criava conta.
"""
import ast
import inspect
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from routes import bff_auth  # noqa: E402
from services import supabase_admin  # noqa: E402


def test_endpoint_signup_existe():
    paths = {r.path for r in bff_auth.router.routes}
    assert "/auth/signup" in paths, f"/auth/signup ausente. rotas: {sorted(paths)}"


def test_cliente_de_auth_e_separado_do_de_db():
    """get_auth_client() nunca pode ser o mesmo objeto de get_admin_client()."""
    assert hasattr(supabase_admin, "get_auth_client")
    src = inspect.getsource(supabase_admin.get_auth_client)
    assert "create_client(" in src        # cria um cliente novo
    assert "global _client" not in src    # não reusa o singleton de DB


def test_auth_ops_usam_get_auth_client_nao_o_admin():
    """sign_in_with_password / refresh_session / exchange_code / sign_up / reset_password_email
    não podem ser chamados no cliente retornado por get_admin_client()."""
    src = inspect.getsource(bff_auth)
    tree = ast.parse(src)
    problemas = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute):
            continue
        if node.attr not in {
            "sign_in_with_password", "refresh_session",
            "exchange_code_for_session", "sign_up", "reset_password_email",
        }:
            continue
        # sobe até achar a chamada .auth.<op> e vê quem produziu o objeto
        seg = ast.get_source_segment(src, node) or ""
        # heurística: a linha inteira não pode conter get_admin_client()
        lineno = node.lineno
        line = src.splitlines()[lineno - 1]
        # a chamada pode estar montada em `client = get_...()` linhas antes;
        # aqui exigimos que a MESMA expressão não use get_admin_client diretamente
        if "get_admin_client()" in line:
            problemas.append(f"L{lineno}: {line.strip()}")
    assert not problemas, "auth op no cliente de DB:\n" + "\n".join(problemas)


def test_signup_cria_confirmado_nao_depende_de_smtp():
    """create_user com email_confirm=True — o SMTP do Supabase é frágil/rate-limited."""
    src = inspect.getsource(bff_auth.signup)
    assert "email_confirm" in src and "True" in src
    assert "create_user" in src
