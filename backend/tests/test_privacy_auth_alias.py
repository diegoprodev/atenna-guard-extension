"""
FASE 10.9 B2/B3 — require_auth deve expor `id` e `sub` como aliases de `user_id`.

Sem os aliases, export.py / deletion.py / documents.py / protect.py liam
_user.get("id") / _user.get("sub") == None -> HTTPException(400, "User info incomplete")
e os botoes de LGPD ("Solicitar relatorio", "Solicitar exclusao") nao faziam nada.
"""
from unittest.mock import patch


def test_require_auth_exposes_id_and_sub_aliases():
    from middleware.auth import require_auth

    fake_session = {
        "user_id": "uid-abc-123",
        "email": "user@example.com",
        "plan": "free",
    }

    class Creds:
        credentials = "opaque-token-no-dots"

    with patch("services.session_store.resolve_token", return_value=fake_session):
        out = require_auth(creds=Creds())

    assert out["user_id"] == "uid-abc-123"
    assert out["id"] == "uid-abc-123", "export.py/deletion.py leem _user.get('id')"
    assert out["sub"] == "uid-abc-123", "documents.py/retention.py leem _user.get('sub')"
    assert out["email"] == "user@example.com"


def test_privacy_routes_no_longer_400_on_incomplete_user():
    """A guarda `if not user_id or not email` nao pode mais disparar por causa do alias."""
    from routes import export as export_route
    from routes import deletion as deletion_route

    fake_user = {"user_id": "u1", "id": "u1", "sub": "u1", "email": "a@b.com", "plan": "free"}

    class FakeManager:
        def request_export(self, **kw):
            return {"success": True, "expires_in": "24h"}

        def initiate_deletion(self, **kw):
            return {"success": True}

    import asyncio

    with patch.object(export_route, "get_export_manager", return_value=FakeManager()):
        r = asyncio.run(export_route.request_export(_user=fake_user))
        assert r["success"] is True

    with patch.object(deletion_route, "get_deletion_manager", return_value=FakeManager()):
        r = asyncio.run(deletion_route.initiate_deletion(reason=None, _user=fake_user))
        assert r["success"] is True
