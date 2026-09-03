"""FASE 10.6 — feedback de desinstalação."""
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import app
    from routes import uninstall_feedback as uf
    uf._hits.clear()
    return TestClient(app)


@pytest.fixture
def spy():
    with patch("routes.uninstall_feedback.log_uninstall_feedback", new=AsyncMock()) as m:
        yield m


def test_page_served(client):
    r = client.get("/desinstalado")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "desinstalou" in r.text


def test_valid_feedback_stored(client, spy):
    r = client.post("/uninstall-feedback", json={"reason": "bugs", "detail": "travava"})
    assert r.status_code == 200
    assert r.json() == {"received": True}
    spy.assert_awaited_once()
    assert spy.await_args.kwargs["reason"] == "bugs"


def test_unknown_reason_rejected(client, spy):
    r = client.post("/uninstall-feedback", json={"reason": "porque_sim"})
    assert r.status_code == 422
    spy.assert_not_awaited()


def test_honeypot_silently_dropped(client, spy):
    r = client.post("/uninstall-feedback", json={"reason": "bugs", "website": "http://spam"})
    assert r.status_code == 200
    assert r.json() == {"received": True}
    spy.assert_not_awaited()  # honeypot → não grava


def test_rate_limited_after_5(client, spy):
    for _ in range(5):
        assert client.post("/uninstall-feedback", json={"reason": "outro"}).status_code == 200
    r = client.post("/uninstall-feedback", json={"reason": "outro"})
    assert r.status_code == 429


def test_detail_length_capped(client, spy):
    r = client.post("/uninstall-feedback", json={"reason": "outro", "detail": "x" * 5000})
    assert r.status_code == 422  # pydantic max_length=2000


def test_admin_endpoint_requires_admin(client):
    # sem token → 403 (HTTPBearer) e não 200
    r = client.get("/admin/uninstall-feedback")
    assert r.status_code in (401, 403)


def test_admin_endpoint_lists_rows(client):
    from main import app
    from middleware.admin_auth import require_super_admin

    app.dependency_overrides[require_super_admin] = lambda: {"email": "a@b.com", "role": "super_admin"}
    try:
        with patch("routes.admin.uninstall_feedback.SUPABASE_SERVICE_KEY", "svc"), \
             patch("httpx.AsyncClient.get", new=AsyncMock(return_value=type("R", (), {
                 "is_success": True,
                 "headers": {"content-range": "0-1/2"},
                 "json": lambda self=None: [{"id": "1", "reason": "bugs", "detail": "x", "email": None, "ext_version": "2.3.0", "created_at": "2026-09-03T00:00:00Z"}],
             })())):
            r = client.get("/admin/uninstall-feedback")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2
        assert body["data"][0]["reason"] == "bugs"
    finally:
        app.dependency_overrides.pop(require_super_admin, None)
