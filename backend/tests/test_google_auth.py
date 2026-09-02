"""
Tests for POST /auth/google endpoint (FASE 6.3 Google OAuth).
Run: cd /root/atenna-backend && python -m pytest tests/test_google_auth.py -v
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock


def make_app():
    from routes.bff_auth import router
    app = FastAPI()
    app.include_router(router)
    return app


# Unit tests for _extract_google_user

def test_extract_google_user_valid():
    from routes.bff_auth import _extract_google_user
    payload = {
        "access_token": "jwt",
        "refresh_token": "rt",
        "user": {"id": "uid-123", "email": "user@example.com"},
    }
    user_id, email = _extract_google_user(payload)
    assert user_id == "uid-123"
    assert email == "user@example.com"


def test_extract_google_user_empty_payload():
    from routes.bff_auth import _extract_google_user
    with pytest.raises(ValueError):
        _extract_google_user({})


def test_extract_google_user_missing_email():
    from routes.bff_auth import _extract_google_user
    payload = {"user": {"id": "uid-123"}}
    with pytest.raises(ValueError):
        _extract_google_user(payload)


# Integration tests for POST /auth/google

def _mock_supabase_response(status_code, json_data):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.is_success = (200 <= status_code < 300)
    mock_resp.json.return_value = json_data
    return mock_resp


def _make_async_client_mock(response):
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=mock_client)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@patch("routes.bff_auth.get_admin_client")
@patch("routes.bff_auth._get_plan", return_value="free")
@patch("routes.bff_auth.httpx")
def test_google_auth_invalid_code(mock_httpx, mock_plan, mock_admin):
    mock_httpx.AsyncClient.return_value = _make_async_client_mock(
        _mock_supabase_response(400, {"error": "invalid_grant"})
    )
    app = make_app()
    c = TestClient(app)
    r = c.post("/auth/google", json={"code": "badcode", "redirect_uri": "https://test.chromiumapp.org/"})
    assert r.status_code == 401
    assert r.json()["detail"]["error"] == "invalid_or_expired_code"


@patch("routes.bff_auth.get_admin_client")
@patch("routes.bff_auth._get_plan", return_value="free")
@patch("routes.bff_auth.httpx")
def test_google_auth_valid_code(mock_httpx, mock_plan, mock_admin):
    valid_payload = {
        "access_token": "supa-jwt",
        "refresh_token": "supa-rt",
        "user": {"id": "uid-abc", "email": "google@example.com"},
    }
    mock_httpx.AsyncClient.return_value = _make_async_client_mock(
        _mock_supabase_response(200, valid_payload)
    )
    mock_admin.return_value.table.return_value.upsert.return_value.execute.return_value = MagicMock()
    app = make_app()
    c = TestClient(app)
    r = c.post("/auth/google", json={"code": "validcode", "redirect_uri": "https://test.chromiumapp.org/"})
    assert r.status_code == 200
    body = r.json()
    assert "token" in body
    assert "expires_at" in body
    assert body["plan"] == "free"
    assert body["user_id"] == "uid-abc"
    assert body["email"] == "google@example.com"
    assert "access_token" not in body
    assert "supa-jwt" not in str(body)


@patch("routes.bff_auth.get_admin_client")
@patch("routes.bff_auth._get_plan", return_value="free")
@patch("routes.bff_auth.httpx")
def test_google_auth_supabase_500(mock_httpx, mock_plan, mock_admin):
    mock_httpx.AsyncClient.return_value = _make_async_client_mock(
        _mock_supabase_response(500, {"error": "internal"})
    )
    app = make_app()
    c = TestClient(app)
    r = c.post("/auth/google", json={"code": "anycode", "redirect_uri": "https://test.chromiumapp.org/"})
    assert r.status_code == 500
    assert r.json()["detail"]["error"] == "supabase_unavailable"


def test_google_auth_missing_body():
    app = make_app()
    c = TestClient(app)
    r = c.post("/auth/google", json={})
    assert r.status_code == 422
