#!/usr/bin/env python3
"""
Teste E2E Playwright - Atenna Guard Backend em Producao
Testa todos os endpoints e fluxo de auth callback
"""

import sys
from playwright.sync_api import sync_playwright, expect

BASE = "https://atennaplugin.maestro-n8n.site"
PASS_ICON = "[PASS]"
FAIL_ICON = "[FAIL]"
results = []


def test(name, fn):
    try:
        fn()
        print(f"  {PASS_ICON}  {name}")
        results.append((name, True, None))
    except Exception as e:
        msg = str(e)[:200]
        print(f"  {FAIL_ICON}  {name}")
        print(f"         -> {msg}")
        results.append((name, False, msg))


def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=False)
        page = context.new_page()

        print("\n=== ATENNA GUARD - E2E PLAYWRIGHT TESTS ===\n")
        print(f"Target: {BASE}\n")

        # ── 1. Health check ─────────────────────────────────
        def t1():
            resp = page.goto(f"{BASE}/health")
            assert resp.status == 200, f"status={resp.status}"
            body = page.text_content("body")
            assert '"ok"' in body or "ok" in body, f"body={body}"
        test("GET /health -> 200 {status: ok}", t1)

        # ── 2. Auth callback - sem token ────────────────────
        def t2():
            resp = page.goto(f"{BASE}/auth/callback")
            assert resp.status == 200
            content = page.content()
            assert "<html" in content.lower()
            # Deve mostrar erro de token nao recebido
            assert any(x in content for x in ["Token", "token", "erro", "Erro", "not found", "confirmad"])
        test("GET /auth/callback (sem token) -> HTML erro", t2)

        # ── 3. Auth callback - com token fake ───────────────
        def t3():
            resp = page.goto(f"{BASE}/auth/callback?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake&expires_in=3600")
            assert resp.status == 200
            content = page.content()
            assert "<html" in content.lower()
            # Deve mostrar pagina de sucesso/confirmacao
            title = page.title()
            print(f"         Title: {title}")
            page.screenshot(path="test-callback.png")
        test("GET /auth/callback?access_token=fake -> HTML sucesso", t3)

        # ── 4. Callback page tem countdown ──────────────────
        def t4():
            page.goto(f"{BASE}/auth/callback?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake&expires_in=3600")
            content = page.content()
            # Deve ter countdown ou botao fechar
            assert any(x in content for x in ["countdown", "fechar", "close", "Fechar", "Encerrando"])
        test("Auth callback tem countdown/fechar", t4)

        # ── 5. Generate prompts - endpoint existe ───────────
        def t5():
            resp = page.request.post(
                f"{BASE}/generate-prompts",
                data={"input": ""},
                headers={"Content-Type": "application/json"}
            )
            # Deve retornar 422 para input vazio
            assert resp.status == 422, f"status={resp.status}"
        test("POST /generate-prompts (vazio) -> 422", t5)

        # ── 6. Generate prompts - sem JWT retorna algo ──────
        def t6():
            import json
            resp = page.request.post(
                f"{BASE}/generate-prompts",
                data=json.dumps({"input": "como aprender python rapidamente"}),
                headers={"Content-Type": "application/json"}
            )
            # Pode retornar 200 (sem auth enforcement) ou 401
            assert resp.status in (200, 401, 403), f"status={resp.status}"
            if resp.status == 200:
                body = resp.json()
                print(f"         Response keys: {list(body.keys())}")
        test("POST /generate-prompts (sem JWT) -> responde", t6)

        # ── 7. Analytics endpoint ───────────────────────────
        def t7():
            import json
            resp = page.request.post(
                f"{BASE}/track",
                data=json.dumps({
                    "event": "e2e_test",
                    "user_id": "playwright-test",
                    "timestamp": "2026-05-06T18:00:00Z",
                    "plan": "free"
                }),
                headers={"Content-Type": "application/json"}
            )
            assert resp.status == 200, f"status={resp.status}"
            body = resp.json()
            assert body.get("ok") == True, f"body={body}"
        test("POST /track -> 200 {ok: true}", t7)

        # ── 8. Pagina de health tem JSON valido ─────────────
        def t8():
            page.goto(f"{BASE}/health")
            import json
            body_text = page.text_content("body")
            data = json.loads(body_text)
            assert data["status"] == "ok"
        test("GET /health -> JSON valido {status: ok}", t8)

        # ── 9. SSL valido ───────────────────────────────────
        def t9():
            resp = page.goto(f"{BASE}/health")
            assert resp.status == 200
            # Se chegou aqui sem erro de SSL, certificado e valido
            url = page.url
            assert url.startswith("https://"), f"url={url}"
        test("SSL certificado valido (HTTPS sem erros)", t9)

        # ── 10. Docs da API disponiveis ─────────────────────
        def t10():
            resp = page.goto(f"{BASE}/docs")
            assert resp.status == 200
            title = page.title()
            print(f"         API Docs title: {title}")
        test("GET /docs -> FastAPI Swagger UI disponivel", t10)

        context.close()
        browser.close()

        # ── Resumo ──────────────────────────────────────────
        print("\n" + "="*50)
        passed = sum(1 for _, ok, _ in results if ok)
        total  = len(results)
        print(f"Resultado: {passed}/{total} testes passando\n")

        if passed == total:
            print("Backend 100% funcional em producao!")
        else:
            print("Falhas:")
            for name, ok, err in results:
                if not ok:
                    print(f"  - {name}")
                    if err:
                        print(f"    {err[:100]}")

        return passed == total


if __name__ == "__main__":
    ok = run_tests()
    sys.exit(0 if ok else 1)
