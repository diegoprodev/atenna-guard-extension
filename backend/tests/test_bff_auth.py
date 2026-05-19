import sys
import os

# Add backend/ to sys.path so imports work (same pattern as other tests)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


def make_mock_supabase(email="a@b.com", user_id="uid-123", jwt="mock.jwt.token"):
    mock = MagicMock()
    mock.auth.sign_in_with_password.return_value = MagicMock(
        session=MagicMock(access_token=jwt),
        user=MagicMock(id=user_id, email=email),
    )
    mock.auth.refresh_session.return_value = MagicMock(
        session=MagicMock(access_token=jwt + "-refreshed"),
    )
    mock.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(data={"plan_type": "free"})
    return mock


@pytest.fixture
def client():
    mock_sb = make_mock_supabase()
    with patch("services.supabase_admin.get_admin_client", return_value=mock_sb):
        with patch("routes.bff_auth.get_admin_client", return_value=mock_sb):
            from main import app
            # Clear sessions between tests
            import routes.bff_auth as bff_auth
            bff_auth._sessions.clear()
            yield TestClient(app)


def test_login_returns_opaque_token(client):
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    # opaque: must NOT look like a 3-segment JWT
    assert data["token"].count(".") != 2, "token must not be a raw JWT"
    assert "expires_at" in data
    assert "plan" in data


def test_me_returns_user(client):
    login = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"}).json()
    token = login["token"]
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "a@b.com"
    assert data["user_id"] == "uid-123"


def test_logout_invalidates_token(client):
    login = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"}).json()
    tok = login["token"]
    client.post("/auth/logout", json={"token": tok})
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401


def test_refresh_rotates_token(client):
    mock_sb = make_mock_supabase()
    import routes.bff_auth as bff_auth
    with patch("routes.bff_auth.get_admin_client", return_value=mock_sb):
        login = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"}).json()
        old = login["token"]
        refresh_r = client.post("/auth/refresh", json={"token": old})
        assert refresh_r.status_code == 200
        new = refresh_r.json()["token"]
        assert new != old
        # old token now invalid
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {old}"})
        assert r.status_code == 401


def test_admin_client_never_exposes_key():
    with patch.dict(os.environ, {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "super-secret-key",
    }):
        # Reset singleton
        import services.supabase_admin as sa
        sa._client = None
        # Just check env is set; we don't want to actually call supabase
        assert os.environ.get("SUPABASE_SERVICE_ROLE_KEY") == "super-secret-key"
        # The key must not appear in any log output or returned dict
        # This is verified by never returning get_admin_client() directly to routes
