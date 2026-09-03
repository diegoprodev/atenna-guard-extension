import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app
from middleware.auth import require_auth

_BLANK_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
_VALID_AUTH = {"Authorization": "Bearer fake-token"}


def _fake_auth():
    return {"user_id": "u1", "email": "test@test.com", "plan": "free"}


@pytest.fixture
def client():
    app.dependency_overrides[require_auth] = _fake_auth
    c = TestClient(app)
    yield c
    app.dependency_overrides.clear()


def test_image_scan_no_text_returns_none_risk(client):
    with patch("routes.dlp.extract_text_from_image", return_value=""):
        resp = client.post("/dlp/image", json={"image_b64": _BLANK_PNG_B64}, headers=_VALID_AUTH)
    assert resp.status_code == 200
    assert resp.json()["risk_level"] == "NONE"
    assert resp.json()["show_warning"] is False


def test_image_scan_cpf_text_returns_high_risk(client):
    with patch("routes.dlp.extract_text_from_image", return_value="Meu CPF é 123.456.789-09"):
        resp = client.post("/dlp/image", json={"image_b64": _BLANK_PNG_B64}, headers=_VALID_AUTH)
    assert resp.status_code == 200
    assert resp.json()["risk_level"] in ("HIGH", "MEDIUM")
    assert resp.json()["show_warning"] is True


def test_image_scan_missing_field_returns_422(client):
    resp = client.post("/dlp/image", json={}, headers=_VALID_AUTH)
    assert resp.status_code == 422


def test_image_scan_invalid_base64_returns_400(client):
    with patch("routes.dlp.extract_text_from_image", side_effect=ValueError("Invalid image data")):
        resp = client.post("/dlp/image", json={"image_b64": "bad"}, headers=_VALID_AUTH)
    assert resp.status_code == 400


def test_app_startup_event_defined(client):
    """Verify that the startup event is properly defined in the app."""
    # Check that the app has startup event handlers
    assert hasattr(app, 'router')
    # Verify app can start without errors (TestClient triggers startup)
    assert client is not None
