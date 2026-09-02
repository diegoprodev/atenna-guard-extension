# FASE 9.0 — Reconciliação do Backend + Correção do DLP server-side

> **Status:** 🟡 em execução (spec → harness → code review → staging → deploy)
> **Autor:** inspeção sênior 2026-09-01/02
> **Pré-requisito:** produção já recuperada (domínio `api.atennaia.com.br` — ver CHANGELOG 2.2.0)
> **Não fazer merge/deploy antes de:** harness 100% verde em staging + code review aprovado

---

## 1. Contexto e problema

A extensão está publicada na Chrome Web Store. Durante a inspeção descobrimos que:

### 1.1 O código do backend no repo ≠ o que roda em produção ("split-brain")
O `backend/` versionado era um **snapshot parcial** — `main.py` importava ~9 módulos que não
existiam no repo (`routes.admin`, `dlp.rate_limit`, `middleware.security_headers`, …). O backend
real só existia na VPS (`/root/atenna-backend/`), **sem git**, editado com `nano` (15+ arquivos
`.bak`/`.backup5`/`.bak.1780088556`). Divergência nos **dois sentidos**:
- **Produção à frente:** rotas admin (12 arquivos), `routes/auth.py` (`/callback`), `routes/bff_auth.py`
  (`/google` — fix da 2.1.1), `services/geolocation.py`, `utils/fx_rate.py`, CORS com os 5 sites de IA,
  `dlp/scanner.py` com padrões contextuais, `Dockerfile` com Tesseract + upgrade de pip (CVEs).
- **Repo à frente (nunca deployado):** `dlp/analyzer.py` (FASE 5.2), `dlp/pipeline.py` (timeout),
  `services/openai_service.py` (SDK oficial), `dlp/telemetry.py`, `dlp/image_ocr.py`.

### 1.2 🔴 O DLP server-side está QUEBRADO em produção
Teste direto no container de produção:

```
>>> from dlp.analyzer import analyze
>>> analyze("Meu CPF 111.444.777-35")
TypeError: CreditCardRecognizer.__init__() got an unexpected keyword argument 'name'
```

Causa: **bug #5 do CLAUDE.md** — a classe custom `CreditCardRecognizer` colide com o built-in
homônimo do Presidio; quando o registry do Presidio tenta instanciá-la com `name=`, quebra e o
`AnalyzerEngine` inteiro falha ao subir. Além disso, os `PatternRecognizer` de produção **não têm
`supported_language="pt"`** (bug #4 do CLAUDE.md) — mesmo sem a colisão, `get_recognizers(language="pt")`
voltaria vazio.

**Efeito em cascata (tudo com erro engolido — ninguém percebeu porque prod teve 0 tráfego por semanas):**

| Caminho | Usa | Comportamento em produção HOJE |
|---|---|---|
| `/generate-prompts` → `engine.revalidate()` | Presidio `analyze()` | `except Exception` → retorna `risk=UNKNOWN`, `entities=[]` |
| `/dlp/scan` → `pipeline.run()` | Presidio `analyze()` | retorna `risk=NONE` (+ `routes/dlp.py` faz `await` numa função sync → endpoint 500) |
| `/document/protect`, `/document/export-protected` → `scanner.scan()` | regex `scanner.py` | ✅ **funciona** (detecta CPF/RG/cartão, mascara, bloqueia) |

Ou seja: **a proteção de PII em prompts só acontece no cliente.** `STRICT_DLP_MODE=true` está
ligado no `.env` da VPS, mas o motor que ele consultaria nunca roda. Um usuário avançado que
desligue o DLP local (ou chame o `background` direto) manda **PII crua** para o Gemini/OpenAI
sem nenhuma proteção do servidor. Isso viola o princípio zero-trust do produto.

### 1.3 Outros bugs latentes confirmados
- `routes/dlp.py`: `return await run(request)` sobre `pipeline.run` **síncrona** → `/dlp/scan` 500.
- `dlp/pipeline.py` (prod): no `except`, retorna `RiskLevel.NONE` — mascarar erro de análise como
  "nada encontrado" é inseguro; o correto é `UNKNOWN`.
- `services/quota_service.py`: `FREE_DAILY_LIMIT` — prod=5 (correto), repo=10 (errado). Módulo órfão
  (não plugado no `/generate-prompts`, que usa `dlp.rate_limit`), mas testado por `test_quota.py`.
- `.claude/settings.json` versionado apesar do `.gitignore` (comentário do próprio arquivo diz
  "may contain command logs with secrets").
- `routes/email_service.py`: `FROM_EMAIL` apontava para `@maestro-n8n.site` (domínio morto).

---

## 2. Objetivo

1. **Versionar em git o backend real de produção** — `backend/` do repo passa a ser a fonte
   da verdade; fim do `nano` na VPS.
2. **Restaurar a detecção de PII server-side** — `engine.revalidate()` e `/dlp/scan` voltam a
   detectar CPF, CNPJ, cartão, RG, CNH, OAB, placa, CRM, telefone, e-mail, API keys, JWT.
3. **Preservar tudo que já funciona em produção** — rotas admin, e-mails, checkout, documentos,
   auth (incl. `/google` e `/callback`), CORS dos 5 sites de IA, Tesseract, geolocalização.
4. **Provar por harness** que a correção funciona e não regride nada, **antes** de tocar produção.

Fora de escopo desta fase: Stripe (P8), i18n (P9), CI/CD (P3), hardening do host (P7.3),
gestão de segredos (P6). Ver `~/.claude/plans/quero-que-seja-arquiteto-*.md`.

---

## 3. Matriz de reconciliação (decisão arquivo-a-arquivo)

Base = **produção** (estado deployado, funcionando). Sobrepõe-se apenas o que o repo tem de
comprovadamente melhor e nunca foi para o ar.

| Arquivo | Decisão | Rationale | Coberto por teste |
|---|---|---|---|
| `dlp/analyzer.py` | **REPO** | FASE 5.2: `BRCreditCardRecognizer` (sem colisão), `supported_language="pt"` em todos, +5 recognizers (RG/CNH/OAB/Placa/CRM). Prod quebra ao subir. | `test_analyzer_reconciliation.py` |
| `dlp/pipeline.py` | **REPO** | `async def run` (bate com `routes/dlp.py` que já faz `await`), timeout de 3s, retorna `UNKNOWN` (não `NONE`) em erro/timeout. | `test_dlp_pipeline.py` |
| `dlp/telemetry.py` | **REPO** | Superset: define `dlp_timeout()` e `dlp_engine_error()` que `engine.py`/`pipeline.py` chamam (prod chama funções que talvez não existam → `AttributeError` no caminho de erro). | `test_telemetry_surface.py` |
| `dlp/image_ocr.py` | **REPO** | Puramente aditivo (+36/-0). | `test_image_ocr.py` (existente) |
| `services/openai_service.py` | **REPO** | Migração para SDK oficial `AsyncOpenAI` — erros tipados (RateLimit/Timeout/Auth), retry, `base_url` do CF Gateway. Commit `8a57058`, nunca deployado. | `test_openai_service.py` |
| `dlp/scanner.py` | **PROD** | Prod tem padrões contextuais (CPF/RG por keyword sem check-digit, cartão exige contexto, termos processuais) que o repo não tem. `scanner.scan()` funciona perfeitamente hoje. | `test_scanner_contextual.py` |
| `main.py` | **PROD** | `ALLOWED_ORIGINS` inclui os 5 sites de IA — fetches diretos do content script dependem disso. | `test_cors.py` |
| `services/gemini_service.py` | **PROD** | Trata cercas markdown ```json antes da validação de output. | `test_gemini_service.py` |
| `services/prompt_service.py` | **PROD** | Passa `user_id` para o LLM (metadados do CF AI Gateway → rastreio de custo por usuário). | `test_prompt_service.py` |
| `services/quota_service.py` | **PROD** (`=5`) | 5/dia é o valor correto do produto (CLAUDE.md). | `test_quota.py` (ajustar assert) |
| `Dockerfile` | **PROD** | Tesseract (por/eng) + `pip install --upgrade pip` (CVE-2025-8869 e outras). | build de staging |
| `requirements.txt` | **UNIÃO** | `openai>=1.0.0` (SDK) + `apscheduler>=3.10` + `resend>=2.0` + `google-generativeai`. | build de staging |
| `routes/auth.py`, `routes/bff_auth.py`, `routes/deletion.py`, `routes/export.py` | **PROD** | Prod tem `/callback`, `/google` (fix 2.1.1), `_user.get("id") or _user.get("sub")` (mais robusto). | `test_auth_middleware.py`, `test_bff_auth.py`, `test_google_auth.py` |
| Rotas admin, redactors, `middleware/*`, `services/{geolocation,fx_rate,audit_service,error_reporter}`, `routes/{email_service,lifecycle_emails,metrics,protect,renewal,report_problem,export_protected}` | **PROD** (novos no repo) | Só existem em produção. Entram no git como estão. | smoke em staging |
| `routes/email_service.py` | **PROD + fix** | `FROM_EMAIL` → `noreply@atennaia.com.br` (era domínio morto). ⚠️ exige verificar domínio no Resend. | manual |
| `routes/checkout.py`, `security/monitor.py` | **PROD + fix** | `VPS_BASE`/URLs → `api.atennaia.com.br`. | `test_checkout_urls.py` |
| `docker-compose.yml`, `nginx/default.conf` | **NOVO no repo** | Estado que roda na VPS (com o volume `nginx/certs` do Cloudflare Origin). Certs continuam fora do git. | — |
| `backend/CHANGELOG.md` | **REMOVER** | Duplicata; o canônico é o `CHANGELOG.md` da raiz. | — |
| `check_gemini_config.py`, `debug_gemini_response.py`, `test_gemini_integration.py`, `test_openai_fallback.py`, root `dlp.py`/`entities.py`/`image_ocr.py` | **REMOVER** | Scratch. | — |

---

## 4. Test harness — cenários mínimos

Local: `backend/tests/`. Roda com `pytest backend/`. Sem rede real (Supabase/LLM mockados);
o Presidio/spaCy rodam de verdade (é o que estamos validando).

### 4.1 `test_analyzer_reconciliation.py` — o motor Presidio volta a funcionar
| # | Cenário | Esperado |
|---|---|---|
| A1 | `AnalyzerEngine` sobe sem exceção | `get_analyzer()` não levanta |
| A2 | Nenhuma classe chamada `CreditCardRecognizer` (só `BRCreditCardRecognizer`) | AST scan do módulo |
| A3 | Todo `PatternRecognizer` custom tem `supported_language="pt"` | AST scan — sem exceção |
| A4 | `analyze("CPF 111.444.777-35")` | detecta `BR_CPF` |
| A5 | CPF inválido (`111.444.777-00`) | **não** detecta (check digit) |
| A6 | `analyze("cartão 4111 1111 1111 1111")` | detecta cartão (Luhn ok) |
| A7 | `analyze("meu cartão é 1234 5678 9012 3456")` (Luhn inválido) | não detecta como cartão |
| A8 | CNPJ, RG (`12.345.678-9`), CNH (11 díg. em contexto), OAB (`OAB/SP 123456`), placa Mercosul (`ABC1D23`) e antiga (`ABC-1234`), CRM | cada um detectado |
| A9 | `sk-...` (API key OpenAI), `AKIA...` (AWS), `eyJ...` (JWT), `ghp_...` | detectados como credencial |
| A10 | Texto técnico ("observer pattern typescript") | **zero** falsos positivos de NOME |
| A11 | E-mail, telefone BR (`(11) 98765-4321`) | detectados |
| A12 | Frontend e backend retornam **os mesmos tipos** para o mesmo input (SI-15) | paridade com `src/dlp` |

### 4.2 `test_dlp_pipeline.py` — resiliência
| # | Cenário | Esperado |
|---|---|---|
| P1 | `await run(ScanRequest(text="CPF 111.444.777-35"))` | `risk_level=HIGH`, entidade `CPF` |
| P2 | `run` é `async` (bate com `routes/dlp.py`) | `inspect.iscoroutinefunction(run)` |
| P3 | análise que estoura 3s (monkeypatch `analyze` lento) | retorna `UNKNOWN`, **nunca** `NONE` |
| P4 | `analyze` levanta exceção (monkeypatch) | retorna `UNKNOWN` + telemetria `dlp_engine_error` |
| P5 | texto vazio | `NONE`, sem erro |

### 4.3 `test_engine_revalidate.py` — zero-trust no `/generate-prompts`
| # | Cenário | Esperado |
|---|---|---|
| E1 | cliente diz `dlp_risk_level=NONE` + texto tem CPF cru | servidor detecta HIGH, `mismatch.has_mismatch=True` |
| E2 | `STRICT_DLP_MODE=true` + servidor=HIGH | `evaluate_strict_enforcement` reescreve o payload (`[CPF]`) |
| E3 | `STRICT_DLP_MODE=false` + servidor=HIGH | não reescreve, mas loga divergência |
| E4 | cliente omite metadados DLP | servidor ainda revalida do zero |
| E5 | `revalidate` nunca propaga exceção (generation não pode ser bloqueada por bug do DLP) | retorna `UNKNOWN` no pior caso |

### 4.4 `test_scanner_contextual.py` — não regredir o path de documentos
| # | Cenário | Esperado |
|---|---|---|
| S1 | `scan("Meu CPF e 111.444.777-35, RG 12.345.678-9, cartão 4111 1111 1111 1111")` | `masked_content == "Meu CPF e [CPF], RG [RG], [CARTAO]"`, `risk=HIGH`, `blocked=True` |
| S2 | CPF por keyword sem check-digit (`CPF: 123.456.789-00`) | mascara (MEDIUM, `source=contextual`) |
| S3 | termos processuais ("réu", "vara criminal") | detectado |
| S4 | texto neutro | `risk=NONE`, `blocked=False`, `masked==original` |

### 4.5 `test_reconciliation_invariants.py` — a spec não regride nada
| # | Invariante |
|---|---|
| R1 | `import main` sobe o app sem `ModuleNotFoundError` (todos os `include_router` resolvem) |
| R2 | Todas as rotas sensíveis têm `Depends(require_auth)`: `/generate-prompts`, `/dlp/scan`, `/dlp/image`, `/checkout/create`, `/track`, `/admin/*`, `/document/*`, `/user/export/*` |
| R3 | `require_auth` rejeita token com exatamente 2 pontos (JWT bruto → 401) |
| R4 | `FREE_DAILY_LIMIT == 5` e `DAILY_LIMIT` (cliente) `== 5` |
| R5 | Nenhum segredo hardcoded em `backend/**` (regex `sk-`, `eyJ`, `AKIA`, `AIza`, `postgres://`) |
| R6 | Nenhuma referência a `maestro-n8n.site` em `backend/**/*.py|*.conf|*.yml` |
| R7 | CORS `ALLOWED_ORIGINS` contém os 5 sites de IA |
| R8 | `routes/checkout.py`: preço/plano vêm da config do servidor, nunca do corpo do request |

### 4.6 `test_zero_trust_bypass.py` — ataque pelo frontend (pytest + httpx TestClient)
| # | Ataque | Esperado |
|---|---|---|
| Z1 | `POST /generate-prompts` com JWT Supabase bruto | 401 |
| Z2 | `POST /generate-prompts` sem `Authorization` | 401 |
| Z3 | `POST /dlp/scan` sem auth | 401 |
| Z4 | `POST /checkout/create` com `{"plan":"free","price":0}` forjado | servidor ignora `price`, usa config |
| Z5 | `POST /track` com payload gigante (1 MB) | 413/422, não 200 |
| Z6 | rota `/admin/overview` com token não-admin | 403 |
| Z7 | `/dlp/image` com base64 inválido | 400, não 500 |

---

## 5. Rollout (staging na própria VPS → produção)

Este PC não tem Docker/Python — staging roda **na VPS**, isolado.

1. `rsync` do `backend/` reconciliado para `/root/atenna-backend-staging/` na VPS
   (com cópia do `.env`/`.env.asaas` reais, `nginx/certs`, `data/` vazio).
2. `docker compose -p atenna-staging up -d --build` — backend na porta **8001** (localhost),
   sem nginx próprio (testes batem em `127.0.0.1:8001`).
3. Rodar o harness **dentro do container de staging**: `docker compose -p atenna-staging exec backend pytest -q`.
4. Validar manualmente:
   - `analyze("CPF 111.444.777-35 cartão 4111 1111 1111 1111 RG 12.345.678-9")` → detecta os 3
   - `curl :8001/health` → ok
   - `curl -X POST :8001/dlp/scan` (com token de teste) → `risk=HIGH`
5. **Code review severo** (seção 6) — aprovado.
6. Só então: `git commit` → atualizar `CHANGELOG.md` (2.3.0) → `git push` → **promover para produção**:
   - `docker compose -p atenna-staging down`
   - backup: `mv /root/atenna-backend /root/atenna-backend.pre-9.0` + `docker compose` continua no antigo até o swap
   - `rsync` para `/root/atenna-backend/`, preservando `.env*`, `nginx/certs`, `data/`
   - `docker compose up -d --build` → healthcheck → smoke (`/health`, `/dlp/scan`, `/generate-prompts` com token real)
   - **rollback:** `rm -rf /root/atenna-backend && mv /root/atenna-backend.pre-9.0 /root/atenna-backend && docker compose up -d --build`

---

## 6. Code review severo — checklist obrigatório

Antes do deploy, revisar e registrar achados em `docs/specs/FASE_9.0_CODE_REVIEW.md`:

- [ ] **Diff arquivo-a-arquivo** dos 5 arquivos "REPO" vs o que rodava — confirmar que cada mudança
  é intencional e não arrasta regressão.
- [ ] `dlp/analyzer.py`: cada regex revisado para ReDoS (catastrophic backtracking); todo recognizer
  com `supported_language`; `get_analyzer()` com `lru_cache`/lazy correto; sem `CreditCardRecognizer`.
- [ ] `dlp/pipeline.py` + `dlp/engine.py`: nenhum caminho retorna `NONE` em erro; `UNKNOWN` propaga
  até o enforcement sem ser tratado como "seguro".
- [ ] `services/openai_service.py`: `assert_safe_llm_url` valida a URL **real** (base_url), canary
  token presente no system prompt, `validate_output` roda antes de retornar.
- [ ] `main.py`: ordem dos middlewares (Sanitization antes de SecurityHeaders), CORS sem `*`,
  `allow_credentials=False`.
- [ ] Nenhum `except: pass` novo que engula erro de segurança.
- [ ] Rotas novas (admin) — todas com `require_auth` + checagem de role admin server-side.
- [ ] `.env.example` / `.env.asaas.example` sem valores reais; `.gitignore` cobre `nginx/certs`,
  `.env.asaas`, `data/`.
- [ ] `requirements.txt`: sem downgrade de nada que a prod usa; `openai` novo não conflita.
- [ ] Rodar o harness completo 2×, verde nas duas.

---

## 7. Critérios de aceite (Definition of Done)

1. `pytest backend/` — 100% verde no container de staging (0 falhas, 0 erros).
2. `analyze()` detecta CPF, CNPJ, cartão, RG, CNH, OAB, placa, CRM, telefone, e-mail, API key, JWT.
3. CPF/cartão inválidos **não** são detectados (sem falso positivo).
4. `engine.revalidate()` com cliente mentindo `NONE` + PII crua → servidor retorna HIGH + mismatch.
5. `STRICT_DLP_MODE=true` → payload com CPF é reescrito para `[CPF]` antes de ir ao LLM.
6. `scanner.scan()` (documentos) — sem regressão (S1–S4 verdes).
7. `import main` sobe o app; todas as rotas registram.
8. Suíte de bypass (Z1–Z7) verde.
9. Code review registrado e aprovado.
10. Smoke em produção pós-deploy: `/health` ok, `/dlp/scan` com token real → `risk=HIGH` para CPF.
11. `CHANGELOG.md` atualizado (2.3.0); tag `v2.3.0`; plano de rollback testado em staging.
