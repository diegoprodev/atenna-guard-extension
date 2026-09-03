"""
POST /auth/google — troca o `code` do OAuth Google por um token opaco do BFF.

Reescrito na FASE 9.2: o contrato antigo (`_extract_google_user`, payload com
`access_token`/`refresh_token`) não existe mais. Hoje o endpoint chama
`get_auth_client().auth.exchange_code_for_session({provider, code})`.
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _mock_auth_client(*, ok=True):
    mock = MagicMock()
    session = MagicMock(
        session=MagicMock(access_token="mock.jwt", refresh_token="mock.refresh"),
        user=MagicMock(id="uid-goog", email="goog@example.com"),
    )
    if ok:
        mock.auth.exchange_code_for_session.return_value = session
        mock.auth.set_session.return_value = session
    else:
        mock.auth.exchange_code_for_session.side_effect = Exception("invalid grant")
        mock.auth.set_session.side_effect = Exception("invalid token")
    # _get_plan → profiles/user_plans
    mock.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=None)
    return mock


@pytest.fixture
def client():
    from main import app
    return TestClient(app)


def test_google_sem_body_422(client):
    r = client.post("/auth/google", json={})
    assert r.status_code == 422


def test_google_code_invalido_401(client):
    with patch("routes.bff_auth.get_auth_client", return_value=_mock_auth_client(ok=False)), \
         patch("routes.bff_auth.get_admin_client", return_value=_mock_auth_client()):
        r = client.post("/auth/google", json={"code": "bad", "redirect_uri": "https://x/cb"})
    assert r.status_code == 401


def test_google_code_valido_retorna_token_opaco(client):
    mock = _mock_auth_client(ok=True)
    with patch("routes.bff_auth.get_auth_client", return_value=mock), \
         patch("routes.bff_auth.get_admin_client", return_value=mock):
        r = client.post("/auth/google", json={"code": "good", "redirect_uri": "https://x/cb"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    assert data["token"].count(".") != 2, "não pode ser um JWT cru"
    assert "expires_at" in data and "plan" in data


def test_google_sessao_sem_user_e_401_nao_500(client):
    """Regressão (code review FASE 9.2): r.session presente mas r.user None → 401 limpo."""
    mock = _mock_auth_client(ok=True)
    mock.auth.exchange_code_for_session.return_value = MagicMock(
        session=MagicMock(access_token="j", refresh_token="r"), user=None,
    )
    with patch("routes.bff_auth.get_auth_client", return_value=mock), \
         patch("routes.bff_auth.get_admin_client", return_value=mock):
        r = client.post("/auth/google", json={"code": "x", "redirect_uri": "https://x/cb"})
    assert r.status_code == 401


def test_google_fluxo_implicito_access_token(client):
    """bffClient manda {access_token, refresh_token} no fluxo implícito do Supabase."""
    mock = _mock_auth_client(ok=True)
    with patch("routes.bff_auth.get_auth_client", return_value=mock), \
         patch("routes.bff_auth.get_admin_client", return_value=mock):
        r = client.post("/auth/google", json={"access_token": "eyJ.x.y", "refresh_token": "r"})
    assert r.status_code == 200, r.text
    assert r.json()["token"].count(".") != 2
    mock.auth.set_session.assert_called_once()
