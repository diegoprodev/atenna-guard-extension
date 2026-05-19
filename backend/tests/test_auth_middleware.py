import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock


@pytest.fixture
def client():
    from main import app
    from routes import bff_auth
    bff_auth._sessions.clear()
    return TestClient(app)


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
    # Seed a valid session directly
    from routes import bff_auth
    import time, uuid
    tok = str(uuid.uuid4())
    bff_auth._sessions[tok] = {
        "supabase_jwt": "mock",
        "refresh_token": "mock-refresh",
        "expires_at": int(time.time()) + 3600,
        "user_id": "uid-test",
        "email": "test@example.com",
        "plan": "free",
    }
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["email"] == "test@example.com"
