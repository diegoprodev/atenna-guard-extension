"""
FASE 9.0 — E2E do endpoint /generate-prompts (camada HTTP + zero-trust).

Usa TestClient com require_auth sobrescrito (usuário de teste) e o LLM mockado.
Prova que o handler inteiro roda: auth → revalidação server-side → enforcement
STRICT → payload reescrito ANTES de chegar ao LLM.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("STRICT_DLP_MODE", "true")
    from fastapi.testclient import TestClient
    import main
    from middleware.auth import require_auth

    main.app.dependency_overrides[require_auth] = lambda: {
        "user_id": "test-user-9-0", "email": "t@t.com", "plan": "pro",
    }

    # captura o texto que chega ao LLM
    captured = {}

    async def fake_generate(input_text, user_id=""):
        captured["llm_input"] = input_text
        return {"direct": "d", "direct_preview": "p", "structured": "s",
                "structured_preview": "p", "technical": "t", "technical_preview": "p"}

    monkeypatch.setattr(main, "generate_prompts", fake_generate)
    c = TestClient(main.app)
    c._captured = captured
    yield c
    main.app.dependency_overrides.clear()


def test_Z0_sem_auth_401():
    from fastapi.testclient import TestClient
    import main
    main.app.dependency_overrides.clear()
    r = TestClient(main.app).post("/generate-prompts", json={"input": "oi"})
    assert r.status_code in (401, 403)


def test_E2E_cliente_mente_NONE_mas_servidor_reescreve_cpf(client):
    """
    O cliente afirma dlp_risk_level=NONE e manda CPF cru.
    STRICT ligado → o texto que chega ao LLM NÃO pode ter o CPF.
    """
    r = client.post("/generate-prompts", json={
        "input": "meu CPF é 111.444.777-35, me ajude a escrever um email",
        "dlp": {"dlp_risk_level": "NONE", "dlp_entity_count": 0, "dlp_entity_types": []},
    })
    assert r.status_code == 200, r.text
    llm_input = client._captured["llm_input"]
    assert "111.444.777-35" not in llm_input, f"CPF cru chegou ao LLM: {llm_input!r}"
    assert "[CPF]" in llm_input


def test_E2E_texto_limpo_passa_intacto(client):
    r = client.post("/generate-prompts", json={
        "input": "como estruturar uma arquitetura de microsserviços?",
        "dlp": {"dlp_risk_level": "NONE"},
    })
    assert r.status_code == 200
    assert client._captured["llm_input"] == "como estruturar uma arquitetura de microsserviços?"
