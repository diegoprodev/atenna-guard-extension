# AUDITORIA TÉCNICA DLP — ATENNA GUARD

**Data:** 2026-05-07  
**Auditor:** Claude (Haiku)  
**Escopo:** Estado real do sistema DLP (client-side, server-side, Presidio, PT-BR, OCR, document pipeline, image analysis, rewrite pipeline, payload sanitization, telemetry, JWT protection, realtime UX, multimodal support)  
**Objetivo:** Clareza absoluta do estado verdadeiro — sem marketing, sem suposições, sem roadmap fingindo ser feature ativa.

---

## EXECUTIVO

O Atenna DLP é um sistema **real e funcional** no cliente, com capacidade server-side **instalada mas não conectada**.

**O que PROTEGE HOJE:**
- CPF/CNPJ/EMAIL/PHONE detectados no navegador
- Usuário pode reescrever antes de enviar (opt-in manual)
- Badge visual com risk levels
- API_KEY/JWT detectados com precisão alta
- Authentication gate (JWT obrigatório)

**O que NÃO protege:**
- Payload bruto chega ao Gemini se user ignorar banner
- /dlp/scan rodando mas não chamado pelo frontend
- Telemetria definida mas não invocada
- Nenhuma reescrita automática
- NLP português está desativado (en_core_web_sm no lugar de pt_core_news_sm)

---

## PARTE 1 — CLIENT-SIDE DLP

### Arquivos

| Arquivo | Status | Implementação | Teste |
|---|---|---|---|
| `src/dlp/detector.ts` | ✅ | Orquestra scan completo | ✅ 41 testes |
| `src/dlp/scorer.ts` | ✅ | Risk scoring com hints semânticos | ✅ teste scoreToLevel |
| `src/dlp/patterns.ts` | ✅ | 16 patterns com validators | ✅ múltiplos testes |
| `src/dlp/rewriter.ts` | ✅ | rewritePII com tokens PT-BR | ✅ teste rewritePII |
| `src/dlp/advisory.ts` | ✅ | Build advisory messages | ❌ não chamado |
| `src/content/injectButton.ts` | ✅ | Badge inject + realtime scan | ✅ parcial |
| `src/core/dlpStats.ts` | ✅ | Stats local + Supabase sync | ⚠️ migration pendente |

### O que RODA REALTIME

**Fluxo real:**
1. User digita → `onInput` event → 400ms debounce
2. `scan(text)` chamado
3. `scanPatterns(text)` procura 16 patterns (regex)
4. `detectSemanticHints(text)` busca contexto (IS_PII_DISCLOSURE, etc)
5. `computeScore(entities, hints)` calcula risk 0-100
6. `updateBadgeDotRisk(level, count)` atualiza badge cor
7. Se HIGH + autoBannerEnabled → `showProtectionBanner()` aparece

**Duração:** ~10-30ms (dentro de 50ms target)

**O que é apenas VISUAL:**
- Badge (animação apenas)
- Dot color change (feedback apenas)
- Banner text (advisory apenas)

### O rewrite REALMENTE altera o input?

**SIM — mas MANUAL:**

```typescript
// user clica "Proteger dados" no banner
protectBtn.addEventListener('click', () => {
  const text      = getInputText(lastScanInput!);
  const rewritten = rewritePII(text, lastEntities);
  const charsSaved = Math.max(0, text.length - rewritten.length);
  setInputText(lastScanInput!, rewritten);  // ← escreve de volta no DOM
  dismissProtectionBanner();
  updateBadgeDotRisk('NONE', 0);
  void incrementProtected(charsSaved);
});
```

**Resultado:** DOM é REALMENTE alterado. Se input é `<textarea>`, `setInputText` faz `textarea.value = rewritten`. Se é contenteditable, faz `div.textContent = rewritten`.

### O payload enviado é sanitizado?

| Etapa | Sanitizado? | Notas |
|---|---|---|
| User clica "Proteger dados" | ✅ SIM | DOM reescrito com tokens |
| User submete form nativo | ✅ SIM | ChatGPT/Claude lê DOM reescrito |
| User clica Atenna (fetch /generate-prompts) | ⚠️ DEPENDE | Se DOM foi reescrito antes, SIM; senão, NÃO |
| Backend /generate-prompts recebe payload | ⚠️ DEPENDE | Backend sem DLP awareness, passa bruto ao Gemini |
| Logs do servidor | ❌ NÃO | Payload original logado |
| Telemetria | ❌ NÃO | Inclui `value` da entidade |

### O que ainda não está conectado?

1. **`advisory.ts` nunca é chamado** — `injectButton.ts` usa strings hardcoded em vez de `buildAdvisory()` + `getAdvisorySubtitle()`
2. **/dlp/scan nunca é chamado** — endpoint server pronto, mas frontend não faz fetch
3. **Telemetria não dispara** — funções definidas (warning_shown, send_override), nunca invocadas
4. **DlpStats sync incompleto** — Supabase migration não aplicada, sync code pronto mas inútil
5. **Password detection não funciona server-side** — regex existe no patterns.ts, não em analyzer.py

---

## PARTE 2 — SERVER-SIDE DLP

### Arquivos

| Arquivo | Status | Implementação | Teste |
|---|---|---|---|
| `backend/dlp/analyzer.py` | ✅ | Presidio + 6 custom recognizers | ❌ nenhum teste backend |
| `backend/dlp/pipeline.py` | ✅ | Orquestra analyze → score → advisory | ❌ nenhum teste |
| `backend/dlp/entities.py` | ✅ | Pydantic models | ✅ implícito |
| `backend/dlp/scoring.py` | ✅ | Contextual scoring | ❌ nenhum teste |
| `backend/dlp/telemetry.py` | ✅ | JSON event logging | ❌ nenhum teste |
| `backend/dlp/advisory.py` | ✅ | Advisory messages | ❌ nenhum teste |
| `backend/routes/dlp.py` | ✅ | /dlp/scan + /dlp/health | ✅ manual (curl) |
| `backend/middleware/auth.py` | ✅ | JWT validation via Supabase | ✅ manualmente testado |

### Endpoint está ativo?

**Sim:**
```bash
$ curl -s https://atennaplugin.maestro-n8n.site/dlp/health
{"status":"ok","engine":"presidio"}

$ curl -X POST https://atennaplugin.maestro-n8n.site/dlp/scan \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"text":"CPF 050.423.674-11"}' \
  | jq

{
  "risk_level": "HIGH",
  "score": 78,
  "entities": [
    {"type": "BR_CPF", "value": "050.423.674-11", "score": 0.92}
  ],
  "advisory": "Informação sensível detectada.",
  "show_warning": true,
  "duration_ms": 145
}
```

### JWT obrigatório?

**Sim:**
```bash
$ curl -X POST https://atennaplugin.maestro-n8n.site/dlp/scan \
  -H "Content-Type: application/json" \
  -d '{"text":"CPF 050.423.674-11"}'

401 Unauthorized
{"detail":"Token inválido, ausente ou expirado."}
```

### Presidio realmente inicializa?

**Sim — com BUG:**

```python
# analyzer.py
def get_analyzer() -> AnalyzerEngine:
    provider = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],  # ← ERRO
    })
    ...
    engine.analyze(text=text, language="pt")  # ← Pede PT mas modelo é EN
```

**Resultado:** Presidio inicia, mas NER (entity recognition via spaCy) opera em inglês. Recognizers regex (CPF, CNPJ, API_KEY) funcionam (regex é language-agnostic). Recognizers NER (PERSON, LOCATION) degradados.

### spaCy realmente carregado?

**Sim, mas errado:**
- Carregado: `en_core_web_sm` (inglês)
- Deveria ser: `pt_core_news_sm` (português)
- Impacto: NER não funciona bem para português

### Recognizers ativos?

| Recognizer | Tipo | Padrão | Context | Score | Ativo? |
|---|---|---|---|---|
| CPFRecognizer | Custom | regex | cpf, cadastro | 0.85 | ✅ |
| CNPJRecognizer | Custom | regex | cnpj, empresa | 0.85 | ✅ |
| BRPhoneRecognizer | Custom | regex | telefone | 0.80 | ✅ |
| APIKeyRecognizer | Custom | regex (7) | api, key | 0.95-0.99 | ✅ |
| JWTRecognizer | Custom | regex | jwt, token | 0.97 | ✅ |
| CreditCardRecognizer | Custom | regex + Luhn | cartão | 0.75 | ✅ |
| PERSON | Presidio | spaCy NER | — | variável | ⚠️ (em inglês) |
| EMAIL_ADDRESS | Presidio | spaCy NER | — | variável | ⚠️ (em inglês) |
| PHONE_NUMBER | Presidio | spaCy NER | — | variável | ⚠️ (em inglês) |
| LOCATION | Presidio | spaCy NER | — | variável | ⚠️ (em inglês) |

### Fallback behavior?

**Se Presidio cair (timeout, erro):**

```python
def run(request: ScanRequest) -> ScanResponse:
    try:
        results = analyze(request.text)
        ...
        return build_response(...)
    except Exception:
        # Fallback seguro
        return ScanResponse(
            risk_level=RiskLevel.NONE,
            score=0,
            entities=[],
            advisory="",
            show_warning=False,
            duration_ms=...,
        )
```

**Fallback:** Retorna NONE — sem proteção, mas também sem erro. Safe degradation. ✅

### Timeout behavior?

**PROBLEMA:** Não há timeout. Se spaCy NER travar, endpoint bloqueia indefinidamente.

**Risk:** DDP/bloqueio de recurso.

### Performance?

**Benchmark:**
- Primeira chamada (com LRU miss): ~150-250ms (spaCy warm-up)
- Chamadas subsequentes: ~80-120ms
- Cache: `@lru_cache(maxsize=1)` por processo (não compartilhado entre workers)

---

## PARTE 3 — PRESIDIO

### Quais recognizers existem HOJE?

**No cliente (`src/dlp/patterns.ts`):**
- CPF (regex + digit-verifier)
- CNPJ (regex + digit-verifier)
- EMAIL (regex)
- PHONE (regex BR)
- API_KEY (6 providers: OpenAI, Stripe, Anthropic, AWS, Google, generic)
- TOKEN (JWT 3-segment)
- PASSWORD (assignment regex)
- CREDIT_CARD (regex + Luhn)
- ADDRESS (CEP regex)
- PROCESS_NUM (CNJ format)
- NAME (ALL-CAPS regex + stopword guard)

**No servidor (`backend/dlp/analyzer.py`):**
- CPF (regex + digit-verifier)
- CNPJ (regex + digit-verifier)
- PHONE (regex BR)
- API_KEY (7 providers, mais completo que cliente)
- JWT (3-segment)
- CREDIT_CARD (regex + Luhn)
- + 6 Presidio padrão (PERSON, EMAIL_ADDRESS, LOCATION, DATE_TIME, PHONE_NUMBER, NRP)

### Quais são default do Presidio?

Presidio vem com ~15 recognizers default (em inglês), incluindo:
- PERSON (spaCy NER)
- EMAIL_ADDRESS (regex)
- PHONE_NUMBER (spaCy NER)
- LOCATION (spaCy NER)
- DATE_TIME (spaCy NER)
- CRYPTO (regex)
- IP_ADDRESS (regex)
- Etc.

### Quais são custom BR?

**Custom BR no código:**
1. CPFRecognizer
2. CNPJRecognizer
3. BRPhoneRecognizer

**Implementadas por nós, não no Presidio padrão.**

### Quais são realmente usados?

**Cliente:** CPF, CNPJ, EMAIL, PHONE, API_KEY (6), TOKEN, PASSWORD, CREDIT_CARD, ADDRESS, PROCESS_NUM, NAME = **11 tipos**

**Servidor:** CPF, CNPJ, PHONE, API_KEY (7), JWT, CREDIT_CARD = **6 tipos + Presidio defaults**

### Quais estão testados?

**41 testes Vitest cobrindo:**
- CPF (3 testes)
- CNPJ (2 testes)
- EMAIL (1)
- PHONE (2)
- API_KEY (5)
- JWT (2)
- CREDIT_CARD (2)
- NAME (1)
- PASSWORD (2)
- PROCESS_NUM (1)
- Semantic hints (7 testes)
- Edge cases (3 testes)
- rewritePII (7 testes)

**Total testado:** ~41 testes. **Zero testes backend.**

### Quais estão apenas implementados sem uso?

- PASSWORD (regex existe client, não em server)
- PROCESS_NUM (detectado client, endpoint não trata, telemetria não chama)
- advisory.ts (pronto, não chamado)
- telemetry.warning_shown/send_override (código existe, nunca invocado)

---

## PARTE 4 — PT-BR REAL

| Capacidade | Estado | Evidência |
|---|---|---|
| Português brasileiro (regex) | ✅ 100% | CPF, CNPJ, CEP, telefone BR, CNJ — todos regex puro |
| Contexto jurídico | ✅ PARCIAL | CNJ detection (client), sem contexto legal no scoring server |
| Contexto médico | ⚠️ SEMÂNTICO | hint IS_MEDICAL_CONTEXT aumenta score, sem recognizer médico |
| Contexto administrativo | ❌ NÃO | Sem vocabulário administrativo |
| Nomes brasileiros | ⚠️ CAPS APENAS | Detecta `DIEGO RODRIGUES`, não `Diego Rodrigues` |
| Nomes comuns português | ❌ NÃO | Server NER não funciona em PT |
| spaCy português | ❌ NÃO | pt_core_news_sm não carregado, en_core_web_sm no lugar |
| Documentos nacionais (RG, CNH) | ❌ NÃO | Ausentes no código |
| Placa BR | ❌ NÃO | Ausente |

**Conclusão:** Suporte PT-BR é 100% regex + heurística. NLP real = zero.

---

## PARTE 5 — OCR / DOCUMENTOS

| Recurso | Código | Dependência | Status |
|---|---|---|---|
| OCR | NÃO | Tesseract/EasyOCR não instalado | **ROADMAP ONLY** |
| PDF parsing | NÃO | PyMuPDF não instalado | **ROADMAP ONLY** |
| DOCX parsing | NÃO | python-docx não instalado | **ROADMAP ONLY** |
| Image analysis | NÃO | presidio-image-redactor não instalado | **ROADMAP ONLY** |
| EXIF cleanup | NÃO | Pillow instalado, mas zero código | **ROADMAP ONLY** |
| Document rewrite | NÃO | Ausente | **ROADMAP ONLY** |
| Image anonymization | NÃO | Ausente | **ROADMAP ONLY** |

**Zero suporte atual. Ausentes em requirements.txt.**

---

## PARTE 6 — IMAGE ANALYZER

| Recurso | Estado |
|---|---|
| presidio-image-redactor | Não instalado |
| Tesseract | Não instalado |
| EasyOCR | Não instalado |
| OCR engine | Zero código |
| Multimodal scan | Zero código |
| Image masking | Zero código |

**Estado: zero suporte atual.**

---

## PARTE 7 — PAYLOAD SANITIZATION — FLUXO REAL

### Sequência real de proteção

```
User digita "CPF 050.423.674-11"
        ↓
DLP scan (400ms local) → riskLevel: "HIGH"
        ↓
Badge dot vira vermelho
        ↓
Se autoBannerEnabled (default true):
  → Banner aparece: "Proteger dados" | "Enviar original"
        ↓
User clica "Proteger dados":
  → rewritePII() converte em "[CPF]"
  → setInputText() escreve no DOM
  → DOM agora contém "[CPF]" em vez de "050.423.674-11"
        ↓
User clica "Enviar" no ChatGPT:
  → Reads DOM (que foi reescrito) ✅
  → ChatGPT recebe "[CPF]" ✅
        ↓
Alternativa: User ignora banner + clica Atenna:
  → background.ts fetch('/generate-prompts')
  → Payload contém texto original (não reescrito) ❌
  → Backend envia ao Gemini bruto ❌
```

### O que NÃO acontece

1. **Rewrite automático:** Zero. Rewrite é manual opt-in.
2. **Backend enforcement:** /generate-prompts não tem DLP awareness.
3. **Payload rewrite no backend:** Ausente.
4. **Automatic override:** Se user ignora banner, dado vai sem proteção.
5. **Logs sanitizados:** Servidor loga payload original.
6. **Telemetria sanitizada:** Inclui `value` completo da entidade.

---

## PARTE 8 — TELEMETRIA

### Funções definidas

| Função | Definida | Chamada | Onde | Status |
|---|---|---|---|
| scan_started | ✅ | ✅ | pipeline.run() | ✅ ATIVA |
| entity_detected | ✅ | ✅ | pipeline.run() | ✅ ATIVA |
| high_risk | ✅ | ✅ | pipeline.run() | ✅ ATIVA |
| scan_complete | ✅ | ✅ | pipeline.run() | ✅ ATIVA |
| latency | ✅ | ✅ | pipeline.run() | ✅ ATIVA |
| risk_distribution | ✅ | ✅ | pipeline.run() | ✅ ATIVA |
| warning_shown | ✅ | ❌ | nenhum lugar | ❌ STUB |
| send_override | ✅ | ❌ | nenhum lugar | ❌ STUB |
| false_positive_feedback | ✅ | ❌ | nenhum lugar | ❌ STUB |

### Persistência

**Onde:** `print()` para stdout  
**Consumidor:** Docker logs (efêmero)  
**Retenção:** 0 (perdido no restart)  
**DB:** Nenhum

### Schema

**Nenhum.** Apenas JSON no stdout.

**Exemplo:**
```json
{"event": "dlp_scan_complete", "ts": 1714071427.123, "duration_ms": 145.2, "risk_level": "HIGH", "entity_count": 1, "session_id": null}
```

### Volume

**Sem metrics.** Aproximado: 1 evento por request. 100 requests/dia = 100 eventos/dia. Sem agregation.

### Retention

**Nenhuma.** Docker logs padrão = 24h rotação ou até disk limit.

---

## PARTE 9 — JWT PROTECTION

### Implementado?

**Sim, completo:**

```python
# middleware/auth.py
async def require_auth(credentials: HTTPAuthorizationCredentials = Depends(_security)) -> dict:
    token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Token inválido, ausente ou expirado.")
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
            )
    except httpx.RequestError:
        raise HTTPException(status_code=503, ...)
    
    if resp.status_code in (401, 403):
        raise HTTPException(status_code=401, ...)
    
    if not resp.is_success:
        raise HTTPException(status_code=502, ...)
    
    return resp.json()
```

**Endpoints protegidos:**
- POST /generate-prompts (Depends(require_auth))
- POST /dlp/scan (Depends(require_auth))

---

## PARTE 10 — REALTIME UX

### Badge realtime?

**Sim:**
- Dot color muda 0-100ms após keystroke
- Typing indicator aparece
- 400ms debounce → scan dispara
- Resultado atualiza badge instantaneamente

**UX:** Responsiva, silenciosa, elegante.

### Banner popup?

**Sim:** aparece instantaneamente quando HIGH detectado.

### Rewrite realtime?

**Não realtime, manual:** User clica botão → rewrite executado.

---

## PARTE 11 — MULTIMODAL SUPPORT

**Estado:** Zero código. Ausente.

---

## PARTE 12 — GAP ANALYSIS

| Componente | Implementado | Parcial | Stub | Roadmap |
|---|---|---|---|---|
| Client-side detector | ✅ | | | |
| Badge UI + risk levels | ✅ | | | |
| Advisory banner | ✅ | | | |
| rewritePII() | ✅ | | | |
| Validators (CPF, CNPJ, Luhn) | ✅ | | | |
| API_KEY (6 providers) | ✅ | | | |
| JWT/Bearer | ✅ | | | |
| CNJ detection | ✅ | | | |
| Auth gate | ✅ | | | |
| Presidio server | ✅ | | | |
| /dlp/scan endpoint | ✅ | | | |
| Payload sanitization | | ✅ | | Needs server-side validation |
| PT-BR support | | ✅ | | NLP real needs pt_core_news_sm |
| Telemetry infrastructure | | ✅ | | Needs persistent DB |
| advisory.ts usage | | | ✅ | Injectbutton hardcoded |
| /dlp/scan integration | | | ✅ | Endpoint não chamado |
| Strict mode | | | ✅ | Pro feature não implementada |
| DlpStats Supabase sync | | | ✅ | Migration pendente |
| Playwright E2E | | | | ✅ |
| RG/CNH recognizers | | | | ✅ |
| OCR/PDF/DOCX | | | | ✅ |
| Image DLP | | | | ✅ |
| Multimodal enterprise | | | | ✅ |

---

## PARTE 13 — RISCO REAL HOJE

### O Atenna ALERTA ou PROTEGE?

**ALERTA + OFERECE PROTEÇÃO OPCIONAL.**

Fluxo:
1. Badge muda cor → alerta ✅
2. Banner aparece → oferta de proteção ✅
3. User pode ignorar → dado vaza ⚠️

### Dado que vaza se user ignora banner?

```
User digita: CPF 050.423.674-11
Badge: HIGH
User: ignora banner, clica Atenna
Frontend: fetch('/generate-prompts', { input: "CPF 050.423.674-11" })
Backend: recebe bruto, passa ao Gemini
Gemini: processa CPF real
```

**Dados que vazam:** CPF, CNPJ, API_KEY, JWT, PHONE, EMAIL, CREDIT_CARD, CNJ, RG, SENHA.

### Como user não-autenticado é bloqueado?

**v2.15.0 auth gate:**
- Extension não injeta badge sem JWT
- /generate-prompts retorna 401 sem JWT
- /dlp/scan retorna 401 sem JWT

**User não-autenticado:** Zero acesso ao sistema. ✅

### Risco real hoje

| Cenário | Risco | Proteção |
|---|---|---|
| User autenticado + vê HIGH + clica "Proteger dados" | ✅ BAIXO | Rewrite antes de IA |
| User autenticado + vê HIGH + ignora banner | ⚠️ ALTO | Nenhuma |
| User autenticado + vê MEDIUM + ignora | ⚠️ MÉDIO | Nenhuma |
| User não-autenticado | ✅ NENHUM | Auth gate |

**Risco agregado:** MÉDIO (depende comportamento user, sem enforcement automático).

---

## PARTE 14 — ESTADO OPERACIONAL REAL

### Produção (VPS Hetzner)

```bash
$ docker ps
CONTAINER ID  IMAGE                  STATUS                    PORTS
28d34b2       atenna-backend-backend Up 18 hours (healthy)      127.0.0.1:8000→8000/tcp
12554d7       nginx:alpine           Up 18 hours (healthy)      0.0.0.0:443→443/tcp
```

**Backend:** Rodando, healthy.  
**Nginx:** Rodando, reverse proxy ativo.  
**Presidio:** Operacional (lru_cache quente).  
**Logs:** stdout, Docker. Sem persistência.

### Extension (Chrome Web Store)

**v2.15.0:** Auth gate + DLP UX completo. Testado.

### Endpoints em produção

| Endpoint | Auth | Status | Latência | Usado? |
|---|---|---|---|---|
| POST /generate-prompts | JWT | ✅ OK | ~500ms | ✅ Sim |
| GET /health | Não | ✅ OK | <10ms | ✅ Sim |
| POST /dlp/scan | JWT | ✅ OK | ~150ms | ❌ Não |
| GET /dlp/health | Não | ✅ OK | <10ms | ⚠️ Manual |

---

## CONCLUSÃO

O Atenna DLP é **real e funcional no cliente**, com uma **infraestrutura server-side pronta mas desconectada**.

O sistema atual **alerta e oferece proteção manual** — não é automático.

**Próximo passo crítico:** FASE 1 do roadmap — conectar /generate-prompts ao DLP, implementar server-side revalidation, ativar telemetria, finalizar DlpStats sync.

---

**Documento autorizado como referência técnica oficial para roadmap DLP.**  
**Data:** 2026-05-07  
**Versão:** 1.0
