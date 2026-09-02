# FASE 9.0 — Code Review Severo

> Revisor: inspeção sênior · 2026-09-02
> Alvo: branch `fix/backend-reconciliacao-dlp` (backend reconciliado + correção do DLP)
> Método: diff arquivo-a-arquivo dos itens "REPO"/"NOVO"/"FIX" da matriz da spec + harness em staging
> Veredito: **APROVADO PARA DEPLOY** com 4 follow-ups registrados (FASE 9.1)

---

## 1. Escopo revisado

| Arquivo | Origem | Revisado |
|---|---|---|
| `dlp/analyzer.py` | REPO (FASE 5.2) | ✅ regexes (ReDoS), recognizers, engine singleton |
| `dlp/pipeline.py` | REPO | ✅ async, timeout, retorno em erro |
| `dlp/engine.py` | PROD **+ fix** | ✅ shadowing do `analyze` |
| `dlp/enforcement.py` | PROD **+ fix** | ✅ `RecognizerResult.text`, fail-open→fail-safe |
| `dlp/telemetry.py` | REPO | ✅ superset, assinaturas compatíveis |
| `services/openai_service.py` | REPO (SDK) | ✅ canary, allowlist de URL, validação de output |
| `main.py` | PROD | ✅ ordem de middleware, CORS |
| `requirements.txt` | UNIÃO | ✅ sem downgrade |
| `services/quota_service.py` | PROD | ✅ `FREE_DAILY_LIMIT = 5` |
| 41 arquivos novos (admin, middleware, services, redactors) | PROD | ⚠️ smoke apenas (código já em produção há meses) |

---

## 2. Achados

### 🔴 CR-1 — `engine.py`: shadowing de `analyze` (CORRIGIDO)
`from .analyzer import analyze` (linha 26) era sobrescrito pelo `async def analyze` no
fim do módulo (linha 320). `loop.run_in_executor(None, analyze, text)` acabava rodando a
**corotina** de conveniência, que retorna um objeto coroutine nunca aguardado →
`score_results(coroutine)` → `except Exception` → `revalidate()` sempre `UNKNOWN`.
**Presente em produção há meses.** Combinado com CR-2, deixava o DLP server-side 100% inerte.

**Fix:** `from .analyzer import analyze as _run_presidio` + uso do alias no executor.
**Teste:** `test_E0_engine_nao_faz_shadowing`, `test_E1`, `test_E4`.

### 🔴 CR-2 — `analyzer.py` de produção não subia (CORRIGIDO via adoção da versão REPO)
`class CreditCardRecognizer` colidia com o built-in homônimo do Presidio (`TypeError:
... unexpected keyword argument 'name'`) → `AnalyzerEngine` inteiro falhava. Recognizers
sem `supported_language="pt"`. **Adotada a versão do repo (FASE 5.2):**
`BRCreditCardRecognizer`, `supported_language="pt"` em todos, +5 recognizers (RG/CNH/OAB/
Placa/CRM). **Teste:** `test_A1..A3` (AST) + `test_ptbr_recognizers` (0/11 → 11/11).

### 🔴 CR-3 — `enforcement.py`: strict mode nunca reescrevia + fail-open (CORRIGIDO)
`evaluate_strict_enforcement` recebia `RecognizerResult` e acessava `entity.text` (atributo
inexistente) → exceção → `except` retornava o texto **original** (fail-open). Em STRICT mode,
com o cliente mentindo, **PII crua ia para o LLM**.

**Fix:**
1. `value = input_text[entity.start:entity.end]` (fatia do texto, não `.text`).
2. `except` agora é **fail-safe**: `_fallback_redact()` roda o `scanner.scan()` (regex) e
   usa `masked_content`. Nunca deixa PII crua passar em STRICT mode.
3. Ramo `else` (HIGH sem entidades posicionais) também cai no fallback.

**Teste:** `test_E2_strict_mode_reescreve_payload_com_cpf`, `test_E2E_cliente_mente_NONE_mas_servidor_reescreve_cpf`.

### 🟠 CR-4 — `pipeline.py` de produção: `run()` sync + `routes/dlp.py` faz `await` (CORRIGIDO via adoção da versão REPO)
`routes/dlp.py`: `return await run(request)`; `pipeline.run` de prod era `def run` (sync)
→ `/dlp/scan` levantava `TypeError` (não se pode `await` um `ScanResponse`). Além disso o
`except` de prod retornava `RiskLevel.NONE` — mascarar falha de análise como "seguro".
**Adotada a versão do repo:** `async def run`, timeout de 3 s, retorna `UNKNOWN` (nunca `NONE`).
**Teste:** `test_P1..P5`, `test_P_regressao_prod_nunca_retorna_NONE_em_erro`.

### 🟡 CR-5 — `openai_service.py` (SDK): revisão de segurança — OK
- `sanitize_input` antes do uso; rejeita em `threat_level != NONE`.
- `assert_safe_llm_url(base_url)` valida contra allowlist (`api.openai.com`,
  `gateway.ai.cloudflare.com`), força HTTPS.
- Canary token no system prompt + `validate_output(content, canary)` — defesa contra
  prompt-injection / vazamento de configuração.
- Erros tipados (RateLimit/Timeout/Auth/APIStatus) + fallback genérico.
- Nenhum segredo em log. `max_tokens=2000`, `timeout=15s`.
- **Nit (não bloqueia):** `json.loads(raw, strict=False)` permite control chars; mitigado por
  `validate_output` rodar antes. Uso misto de `print()` e `logger`.

### 🟡 CR-6 — `analyzer.py`: ReDoS — OK
Todas as regexes são lineares: quantificadores `{n,}` sem aninhamento ambíguo, âncoras
literais (`.`, `\b`) entre segmentos. `analyze()` tem guard `len(text.strip()) < 4` e é
sempre chamado dentro de `asyncio.wait_for(timeout=3s)` no engine/pipeline. Sem risco prático.

### 🟡 CR-7 — `main.py`: ordem de middleware — OK
`SanitizationMiddleware` → `SecurityHeadersMiddleware` → `CORSMiddleware` (adicionados nessa
ordem; Starlette aplica LIFO no request). Fluxo do request: CORS → SecurityHeaders →
Sanitization → rota. CORS mais externo = correto. `allow_origins` sem `*`,
`allow_credentials=False`, inclui os 5 sites de IA.

### ⚪ CR-8 — 41 arquivos novos (rotas admin etc.) — smoke apenas
São código **já em produção há meses**, apenas nunca versionado. Não passaram por review
linha-a-linha nesta fase (fora do escopo — o objetivo é *versionar o que roda*, não auditar
tudo). Auditoria de segurança dessas rotas (RBAC admin, `require_auth` em cada uma) fica na
**FASE 9.1** (parte do P-ZT do plano). `test_R1` garante que `import main` sobe;
`test_R2` que as rotas sensíveis conhecidas têm `require_auth`.

---

## 3. Regressão

Harness completo rodado em **3 ambientes**:

| Ambiente | Resultado |
|---|---|
| Produção pristina (baseline) | **119 passed, 58 failed** — DLP totalmente quebrado |
| Staging (com FASE 9.0) | **406 passed, 32 failed** → **+287 testes passam** |
| Harness FASE 9.0 dedicado | **51/51 passed** |

As **32 falhas remanescentes em staging são todas pré-existentes** (subconjunto das 58):
- `test_google_auth.py` (7) — testa uma API de helper que a versão de prod do `bff_auth` não expõe
- `test_export_manager.py` / `test_supabase_persistence.py` / `test_retention_manager.py` /
  `test_deletion_manager.py` (~17) — precisam de credenciais Supabase reais
- `test_bff_auth.py` (2) / `test_auth_middleware.py` (1) — precisam de sessão viva no store
- `test_document_abuse.py` (3) — testes do repo vs parsers de documento de prod
- `test_dlp_phase_4_2a.py` (2) — ver CR-follow-ups

**Nenhuma regressão introduzida pela FASE 9.0.**

---

## 4. Follow-ups (FASE 9.1 — não bloqueiam este deploy)

| # | Item | Severidade |
|---|---|---|
| F-1 | `scanner.py`: regex de cartão exige keyword `cartao` **sem acento** → `"Cartão: 4111 1111 1111 1111"` não é pego pelo path de documentos (o `/generate-prompts` pega via Presidio). Adicionar `cartão/crédito/débito` + fallback Luhn sem keyword. | Média |
| F-2 | `scanner.py`: padrão `LEGAL_CONTEXT` (`sentença/mandado/habeas corpus nº`) não dispara — só o número de processo CNJ estruturado é detectado. | Baixa |
| F-3 | Consertar/rescrever os testes órfãos: `test_google_auth.py`, `test_pdf_parser_v2.py` (removido), `test_document_abuse.py` — alinhar com o código de prod adotado. | Baixa |
| F-4 | Auditoria de segurança das rotas `/admin/*` (RBAC server-side, `require_auth` + checagem de role em cada endpoint) — parte do P-ZT do plano-mãe. | Média |

---

## 5. Checklist de deploy (obrigatório antes de promover staging→prod)

- [x] Harness FASE 9.0 verde em staging (51/51)
- [x] `test_ptbr_recognizers` verde em staging (11/11)
- [x] `import main` sobe em staging (`test_R1` + container de pipeline)
- [x] Zero regressão confirmada (baseline vs staging)
- [x] `analyze()` valida CPF/cartão por Luhn/dígito verificador (sem falso positivo)
- [x] E2E: cliente mente `NONE` + CPF cru → `[CPF]` chega ao LLM (STRICT)
- [ ] `git commit` na branch + `CHANGELOG.md` → 2.3.0
- [ ] `git push`
- [ ] Promover: backup `/root/atenna-backend` → `.pre-9.0`, rsync, `docker compose up -d --build`
- [ ] Smoke pós-deploy: `/health`, `/dlp/scan` com token real → `risk=HIGH` para CPF, `/generate-prompts`
- [ ] Plano de rollback validado (`mv .pre-9.0` de volta + rebuild)
- [ ] `docker compose -p atenna-staging down` + limpar `/root/atenna-backend-staging`
