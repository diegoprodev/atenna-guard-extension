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
