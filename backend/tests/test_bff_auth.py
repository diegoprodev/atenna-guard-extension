import sys
import os

# Add backend/ to sys.path so imports work (same pattern as other tests)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


class MockSupabaseTable:
    """Mock Supabase table operations for bff_sessions."""
    def __init__(self, table_name, sessions_store):
        self.table_name = table_name
        self.sessions_store = sessions_store
        self.query_filters = {}
        self.is_delete_op = False

    def insert(self, data):
        """Insert a session."""
        if self.table_name == 'bff_sessions':
            self.sessions_store[data['token']] = data
        return self

    def select(self, *args):
        """SELECT operation."""
        return self

    def eq(self, field, value):
        """WHERE field = value."""
        self.query_filters[field] = value
        return self

    def single(self):
        """Fetch single row."""
        return self

    def delete(self):
        """DELETE operation."""
        self.is_delete_op = True
        return self

    def execute(self):
        """Execute the query."""
        if self.table_name == 'bff_sessions':
            # DELETE case
            if self.is_delete_op and 'token' in self.query_filters:
                self.sessions_store.pop(self.query_filters['token'], None)
                return MagicMock(data=None)
            # SELECT case
            elif 'token' in self.query_filters:
                token = self.query_filters['token']
                data = self.sessions_store.get(token)
                return MagicMock(data=data)
        # user_plans table (for _get_plan)
        elif self.table_name == 'user_plans':
            return MagicMock(data={"plan_type": "free"})
        return MagicMock(data=None)


def make_mock_supabase(email="a@b.com", user_id="uid-123", jwt="mock.jwt.token"):
    sessions_store = {}

    mock = MagicMock()
    mock.auth.sign_in_with_password.return_value = MagicMock(
        session=MagicMock(access_token=jwt, refresh_token="mock-refresh-token"),
        user=MagicMock(id=user_id, email=email),
    )
    mock.auth.refresh_session.return_value = MagicMock(
        session=MagicMock(access_token=jwt + "-refreshed", refresh_token="mock-refresh-token-2"),
    )

    def table_side_effect(table_name):
        return MockSupabaseTable(table_name, sessions_store)

    mock.table.side_effect = table_side_effect
    mock._sessions_store = sessions_store  # Expose for test assertions
    return mock


@pytest.fixture
def client():
    mock_sb = make_mock_supabase()
    with patch("services.supabase_admin.get_admin_client", return_value=mock_sb):
        with patch("routes.bff_auth.get_admin_client", return_value=mock_sb):
            from main import app
            yield TestClient(app)
            # Clear sessions between tests
            mock_sb._sessions_store.clear()


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


def test_login_response_does_not_expose_service_key(client):
    """The /auth/login response body must never contain the service role key value."""
    secret_key = "super-secret-service-role-key"
    with patch.dict(os.environ, {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": secret_key,
    }):
        resp = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"})
        assert resp.status_code == 200
        body_text = resp.text
        assert secret_key not in body_text, "Service role key must not appear in login response"
