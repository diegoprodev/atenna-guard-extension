"""
FASE 9.1 — métricas Prometheus.

Valida:
- `/metrics` responde no formato texto do Prometheus e traz as métricas HTTP
  do instrumentator + as métricas de negócio custom.
- os helpers de `observability_metrics` incrementam de verdade (e são no-op-safe).
- o handler `/generate-prompts` incrementa `atenna_quota_blocks_total` no 429 e
  `atenna_dlp_client_server_divergence_total` quando o cliente sub-reporta risco.

O bloqueio de `/metrics` no domínio público é do nginx — testado em infra, não aqui.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

prometheus_client = pytest.importorskip("prometheus_client")


def _sample(name, labels=None):
    return prometheus_client.REGISTRY.get_sample_value(name, labels or {})


def test_metrics_endpoint_formato_prometheus():
    from fastapi.testclient import TestClient
    import main

    main.app.dependency_overrides.clear()
    c = TestClient(main.app)
    # request instrumentada (handler não-excluído): sem auth → 401/403, mas conta
    c.post("/generate-prompts", json={"input": "x"})
    r = c.get("/metrics")

    assert r.status_code == 200
    assert "text/plain" in r.headers["content-type"]
    body = r.text
    # métricas HTTP do instrumentator
    assert "http_request" in body, "instrumentator não registrou métricas HTTP"
    # métricas de negócio declaradas (existem mesmo com valor 0)
    assert "atenna_quota_blocks_total" in body
    assert "atenna_dlp_scans_total" in body
    assert "atenna_bff_session_store" in body


def test_helpers_incrementam_e_sao_noop_safe():
    import observability_metrics as m

    before = _sample("atenna_dlp_scans_total", {"risk_level": "HIGH"}) or 0.0
    m.record_dlp_scan("HIGH")
    after = _sample("atenna_dlp_scans_total", {"risk_level": "HIGH"}) or 0.0
    assert after == before + 1

    # entradas malformadas não podem levantar
    m.record_dlp_scan(None)
    m.record_quota_block(None)
    m.record_generation("x", "y")
    m.set_bff_session_store(True)
    m.set_bff_session_store(False)
    assert (_sample("atenna_bff_session_store") or 0.0) == 0.0
    m.set_bff_session_store(True)


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("STRICT_DLP_MODE", "true")
    from fastapi.testclient import TestClient
    import main
    from middleware.auth import require_auth

    main.app.dependency_overrides[require_auth] = lambda: {
        "user_id": "test-metrics", "email": "t@t.com", "plan": "free",
    }

    async def fake_generate(input_text, user_id=""):
        return {"direct": "d", "direct_preview": "p", "structured": "s",
                "structured_preview": "p", "technical": "t", "technical_preview": "p"}

    monkeypatch.setattr(main, "generate_prompts", fake_generate)
    c = TestClient(main.app)
    yield c
    main.app.dependency_overrides.clear()


def test_quota_block_incrementa_metric(client, monkeypatch):
    """
    Regressão: o handler lia `_user.get("id")`, mas require_auth devolve
    `{"user_id": ...}` → user_id ficava None → cota server-side NÃO era aplicada
    (bug em produção desde 2026-05). Este teste só passa com user_id resolvido.
    """
    import main

    # força a cota estourada
    monkeypatch.setattr(main, "get_user_plan", lambda uid: "free")
    monkeypatch.setattr(
        main, "check_rate_limit",
        lambda uid, plan: {"allowed": False, "count": 99, "limit": 5,
                           "window": "day", "reset_at": None},
    )

    before = _sample("atenna_quota_blocks_total", {"plan": "free"}) or 0.0
    r = client.post("/generate-prompts", json={"input": "oi", "dlp": {"dlp_risk_level": "NONE"}})
    assert r.status_code == 429
    after = _sample("atenna_quota_blocks_total", {"plan": "free"}) or 0.0
    assert after == before + 1


def test_user_id_do_token_e_repassado_ao_rate_limit(client, monkeypatch):
    """require_auth devolve {"user_id": X} → o handler tem que chamar check_rate_limit(X, ...)."""
    import main

    seen = {}

    def spy(uid, plan):
        seen["uid"] = uid
        return {"allowed": True, "count": 0, "limit": 5, "window": "day", "reset_at": None}

    monkeypatch.setattr(main, "get_user_plan", lambda uid: "free")
    monkeypatch.setattr(main, "check_rate_limit", spy)

    r = client.post("/generate-prompts", json={"input": "oi", "dlp": {"dlp_risk_level": "NONE"}})
    assert r.status_code == 200, r.text
    assert seen.get("uid") == "test-metrics"


def test_divergencia_cliente_servidor_incrementa_metric(client):
    """Cliente diz NONE + CPF cru → servidor acha HIGH → divergência contabilizada."""
    before = _sample("atenna_dlp_client_server_divergence_total") or 0.0
    r = client.post("/generate-prompts", json={
        "input": "meu CPF é 111.444.777-35, me ajude a escrever um email",
        "dlp": {"dlp_risk_level": "NONE", "dlp_entity_count": 0, "dlp_entity_types": []},
    })
    assert r.status_code == 200, r.text
    after = _sample("atenna_dlp_client_server_divergence_total") or 0.0
    assert after >= before + 1
