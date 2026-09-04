"""
FASE 10.9.4 — POST /auth/admin-login

O endpoint nao existia no backend (404 no painel /nexussafe/). Recriado em
routes/bff_auth.py: valida a senha no Supabase E exige o e-mail em ADMIN_EMAILS.
require_super_admin revalida o gate em toda rota /admin/*.
"""
import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest


def _fake_supabase_auth_ok(uid="u-1", email="devdiegopro@gmail.com"):
    session = SimpleNamespace(access_token="jwt", refresh_token="refresh")
    user = SimpleNamespace(id=uid, email=email)
    client = SimpleNamespace(auth=SimpleNamespace(
        sign_in_with_password=lambda _creds: SimpleNamespace(session=session, user=user)
    ))
    return client


def test_admin_login_rejects_non_admin_email():
    from routes import bff_auth

    bff_auth._login_attempts.clear()
    with patch.dict("os.environ", {"ADMIN_EMAILS": "devdiegopro@gmail.com"}):
        with pytest.raises(Exception) as exc:
            asyncio.run(bff_auth.admin_login(bff_auth.LoginRequest(
                email="rando@gmail.com", password="whatever",
            )))
    assert getattr(exc.value, "status_code", None) == 403


def test_admin_login_issues_token_for_admin_email():
    from routes import bff_auth

    bff_auth._login_attempts.clear()
    with patch.dict("os.environ", {"ADMIN_EMAILS": "devdiegopro@gmail.com"}), \
         patch.object(bff_auth, "get_auth_client", return_value=_fake_supabase_auth_ok()), \
         patch.object(bff_auth, "_get_plan", return_value="pro"), \
         patch.object(bff_auth, "_issue_token", return_value={"token": "opaque-xyz", "expires_at": 1, "plan": "pro"}):
        out = asyncio.run(bff_auth.admin_login(bff_auth.LoginRequest(
            email="devdiegopro@gmail.com", password="correct-horse",
        )))
    assert out["token"] == "opaque-xyz"


def test_admin_login_wrong_password_401():
    from routes import bff_auth

    bff_auth._login_attempts.clear()

    def _boom(_creds):
        raise RuntimeError("invalid login credentials")

    bad_client = SimpleNamespace(auth=SimpleNamespace(sign_in_with_password=_boom))
    with patch.dict("os.environ", {"ADMIN_EMAILS": "devdiegopro@gmail.com"}), \
         patch.object(bff_auth, "get_auth_client", return_value=bad_client):
        with pytest.raises(Exception) as exc:
            asyncio.run(bff_auth.admin_login(bff_auth.LoginRequest(
                email="devdiegopro@gmail.com", password="wrong",
            )))
    assert getattr(exc.value, "status_code", None) == 401


def test_require_super_admin_gate_by_admin_emails():
    """Sessao sem role explicita passa se o e-mail estiver na allowlist."""
    from middleware.admin_auth import require_super_admin

    sess = {"user_id": "u1", "email": "devdiegopro@gmail.com", "plan": "pro"}
    req = SimpleNamespace(url=SimpleNamespace(path="/admin/overview"))

    class Creds:
        credentials = "opaque-no-dots"

    with patch.dict("os.environ", {"ADMIN_EMAILS": "devdiegopro@gmail.com"}), \
         patch("services.session_store.resolve_token", return_value=sess):
        out = asyncio.run(require_super_admin(request=req, creds=Creds()))
    assert out["email"] == "devdiegopro@gmail.com"
    assert out["id"] == "u1"


def test_require_super_admin_denies_non_admin():
    from middleware.admin_auth import require_super_admin

    sess = {"user_id": "u2", "email": "rando@gmail.com", "plan": "free"}
    req = SimpleNamespace(url=SimpleNamespace(path="/admin/overview"))

    class Creds:
        credentials = "opaque-no-dots"

    with patch.dict("os.environ", {"ADMIN_EMAILS": "devdiegopro@gmail.com"}), \
         patch("services.session_store.resolve_token", return_value=sess):
        with pytest.raises(Exception) as exc:
            asyncio.run(require_super_admin(request=req, creds=Creds()))
    assert getattr(exc.value, "status_code", None) == 403
