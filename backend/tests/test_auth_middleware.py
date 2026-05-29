import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import time
import uuid


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


def make_mock_supabase(sessions_store):
    """Create a mock Supabase client."""
    mock = MagicMock()

    def table_side_effect(table_name):
        return MockSupabaseTable(table_name, sessions_store)

    mock.table.side_effect = table_side_effect
    return mock


@pytest.fixture
def client():
    sessions_store = {}
    mock_sb = make_mock_supabase(sessions_store)

    with patch("services.supabase_admin.get_admin_client", return_value=mock_sb):
        with patch("routes.bff_auth.get_admin_client", return_value=mock_sb):
            from main import app
            yield TestClient(app)


def test_raw_jwt_rejected(client):
    fake_jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiZmFrZSJ9.signature"
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {fake_jwt}"})
    assert r.status_code == 401
    assert "Raw JWT" in r.json().get("detail", "")


def test_no_token_rejected(client):
    r = client.get("/auth/me")
    assert r.status_code in (401, 403)  # HTTPBearer raises 403 or 401 depending on FastAPI version


def test_invalid_opaque_token_rejected(client):
    r = client.get("/auth/me", headers={"Authorization": "Bearer not-a-valid-uuid"})
    assert r.status_code == 401


def test_valid_opaque_token_accepted(client):
    # Seed a valid session directly via the mock Supabase table
    from services.supabase_admin import get_admin_client

    sessions_store = {}
    mock_sb = make_mock_supabase(sessions_store)

    tok = str(uuid.uuid4())
    sessions_store[tok] = {
        "supabase_jwt": "mock",
        "refresh_token": "mock-refresh",
        "expires_at": int(time.time()) + 3600,
        "user_id": "uid-test",
        "email": "test@example.com",
        "plan": "free",
        "token": tok,
    }

    with patch("services.supabase_admin.get_admin_client", return_value=mock_sb):
        with patch("routes.bff_auth.get_admin_client", return_value=mock_sb):
            from main import app
            client = TestClient(app)
            r = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200
            assert r.json()["email"] == "test@example.com"
