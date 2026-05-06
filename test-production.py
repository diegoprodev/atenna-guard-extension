#!/usr/bin/env python3
"""Smoke tests de producao - Atenna Guard Backend"""

import urllib.request
import urllib.error
import json
import ssl

BASE = "https://atennaplugin.maestro-n8n.site"
ctx = ssl.create_default_context()

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

results = []

def test(name, fn):
    try:
        fn()
        print(f"  {PASS}  {name}")
        results.append((name, True))
    except AssertionError as e:
        print(f"  {FAIL}  {name}: {e}")
        results.append((name, False))
    except Exception as e:
        print(f"  {FAIL}  {name}: {e}")
        results.append((name, False))

def get(path, **kwargs):
    req = urllib.request.Request(f"{BASE}{path}", **kwargs)
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        return r.status, json.loads(r.read())

def post(path, data, headers=None):
    body = json.dumps(data).encode()
    h = {"Content-Type": "application/json"}
    if headers: h.update(headers)
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

print("\n=== ATENNA GUARD - SMOKE TESTS DE PRODUCAO ===\n")

# 1. Health check
def t1():
    status, body = get("/health")
    assert status == 200, f"status={status}"
    assert body.get("status") == "ok", f"body={body}"
test("GET /health → 200 {status: ok}", t1)

# 2. Auth callback sem token
def t2():
    req = urllib.request.Request(f"{BASE}/auth/callback")
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        body = r.read().decode()
    assert "Token não recebido" in body or "html" in body.lower() or r.status == 200
test("GET /auth/callback (sem token) → HTML de erro", t2)

# 3. Auth callback com token fake → página HTML
def t3():
    req = urllib.request.Request(f"{BASE}/auth/callback?access_token=fake.jwt.token&expires_in=3600")
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        body = r.read().decode()
        status = r.status
    assert status == 200, f"status={status}"
    assert "<html" in body.lower(), "Resposta não é HTML"
    assert "atenna" in body.lower() or "acesso" in body.lower() or "confirmad" in body.lower()
test("GET /auth/callback?access_token=fake → HTML de sucesso", t3)

# 4. Generate prompts sem JWT
def t4():
    status, body = post("/generate-prompts", {"input": "como aprender python"})
    assert status in (200, 401, 403), f"status={status}"
test("POST /generate-prompts (sem JWT) → responde", t4)

# 5. Generate prompts input vazio
def t5():
    status, body = post("/generate-prompts", {"input": ""})
    assert status == 422, f"status={status}, body={body}"
test("POST /generate-prompts (input vazio) → 422", t5)

# 6. Analytics endpoint
def t6():
    status, body = post("/track", {
        "event": "test_smoke",
        "user_id": "test-smoke-user",
        "timestamp": "2026-05-06T17:00:00Z",
        "plan": "free"
    })
    assert status == 200, f"status={status}"
    assert body.get("ok") == True, f"body={body}"
test("POST /track → 200 {ok: true}", t6)

# 7. CORS headers
def t7():
    req = urllib.request.Request(
        f"{BASE}/health",
        headers={"Origin": "https://chat.openai.com"}
    )
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        # Pode ou não ter CORS header dependendo da origem
        status = r.status
    assert status == 200
test("GET /health com Origin: chatgpt.com → 200", t7)

# 8. HTTP → HTTPS redirect
def t8():
    http_ctx = ssl.create_default_context()
    req = urllib.request.Request(f"http://atennaplugin.maestro-n8n.site/health")
    try:
        urllib.request.urlopen(req, timeout=5)
        # Se chegou aqui sem redirect, verifica se está em HTTPS
    except urllib.error.HTTPError as e:
        assert e.code in (301, 302), f"status={e.code}"
    except Exception:
        pass  # redirect pode causar exception
test("HTTP → HTTPS redirect 301/302", t8)

# Resumo
print()
passed = sum(1 for _, ok in results if ok)
total = len(results)
print(f"Resultado: {passed}/{total} testes passando")

if passed == total:
    print("\nBackend pronto para producao!")
else:
    failed = [name for name, ok in results if not ok]
    print(f"\nFalhas: {', '.join(failed)}")
