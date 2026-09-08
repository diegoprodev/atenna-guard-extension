# ATENNA DLP ENTERPRISE ROADMAP

**Last Updated:** 2026-05-13  
**Version:** 1.0 (Official Source of Truth)  
**Approval:** Required for any changes

---

## STATUS ATUAL

O Atenna possui atualmente:

### IMPLEMENTADO ✅

- Realtime client-side DLP scanner (detector.ts + patterns.ts)
- Badge risk indicator (dot + colors + tooltip)
- Advisory banner with "Proteger dados" | "Enviar original"
- rewritePII() function with semantic tokens ([CPF], [EMAIL], etc)
- CPF/CNPJ validators with digit verification
- API key detection (OpenAI, Stripe, Anthropic, AWS, Google, generic)
- JWT/Bearer token detection (regex 3-segment)
- CNJ process number detection (client-side only)
- Auth gate: JWT obrigatório em todos endpoints
- Presidio operacional na VPS (Docker)
- /dlp/scan endpoint protegido por JWT
- 41 testes Vitest cobrindo detector/scorer/patterns/rewriter
- Semantic hints engine (IS_PII_DISCLOSURE, IS_PROTECTION_QUERY, etc)
- Chrome extension injection + drag positioning

### PARCIAL ⚠️

- **Payload sanitization:** DOM rewrite funciona, mas backend /generate-prompts ainda recebe bruto
- **PT-BR support:** 100% regex + heurística; NLP = zero (en_core_web_sm carregado, pt_core_news_sm ausente)
- **Telemetry:** funções definidas (dlp_warning_shown, dlp_send_override), nunca chamadas
- **Rewrite flow:** manual opt-in via banner; sem automático
- **Server-side validation:** /dlp/scan pronto, não chamado do frontend; sem re-validation no /generate-prompts
- **DlpStats sync:** código + Supabase migration implementados, tabela não criada
- **advisory.ts integration:** arquivo pronto, injectButton.ts usa strings hardcoded em vez disso

### AUSENTE ❌

- OCR (Tesseract, EasyOCR)
- Document upload pipeline (PDF, DOCX parsing)
- Image analysis (presidio-image-redactor)
- Multimodal DLP
- E2E browser tests (Playwright)
- Automatic server-side enforcement
- Persistent telemetry (DB + dashboard)
- Nomes não-capitalizados (NLP real)
- RG, CNH, Placa, CEP enriquecido
- Compliance dashboard
- Audit trail + forensic logs

---

## PRINCÍPIO CENTRAL

**O diferencial do Atenna NÃO é:**
- prompt builder (existem muitos)
- onboarding (existem muitos)
- IA genérica (existe OpenAI, Anthropic, etc)

**O diferencial É:**
> "proteção contextual invisível antes da IA — no ponto de entrada, antes do modelo."

Toda decisão futura deve preservar:
- ✅ UX silenciosa (não pop-ups alarmistas)
- ✅ Baixa fricção (rewrite ≠ rejeição)
- ✅ Proteção elegante (tokens semânticos, não censura)
- ✅ Simplicidade operacional (regex + heurística, não LLM pesado)
- ✅ Contexto brasileiro (CPF, CNPJ, CNJ, jurídico, médico)

---

## FASE 1 — ENFORCEMENT REAL (PRIORIDADE ABSOLUTA)

**Objetivo:** Fechar o principal risco atual — payload bruto chegando ao Gemini.

**Duração estimada:** 2–3 semanas

### 1.1 /generate-prompts Awareness

**O quê:**
- Backend deve saber se houve DLP client-side
- Backend deve receber metadata de protection via payload

**Como:**
```typescript
// src/background/background.ts
fetch(BACKEND_URL, {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({
    input: inputText,
    dlp: {
      client_risk_level: result.riskLevel,  // "HIGH" | "MEDIUM" | etc
      client_score: result.score,
      client_entities_count: result.entities.length,
      user_protected: userClickedProtectButton,  // true | false
    }
  })
})
```

**Critério:** Backend recebe `dlp` metadata estruturada em cada request.

### 1.2 Server-Side Revalidation

**O quê:**
- Backend reanalisa payloads marcados como HIGH client-side
- Validar se cliente está mentindo ou foi tampado

**Como:**
```python
# backend/routes/prompt.py
@app.post("/generate-prompts")
async def generate(request: PromptRequest, user: dict = Depends(require_auth)):
    if request.dlp and request.dlp.client_risk_level == "HIGH":
        # re-scan server-side
        dlp_result = analyze(request.input)
        if dlp_result.risk_level == "HIGH":
            # confirm — high risk
            ...
```

**Critério:** High risk payloads validated server-side antes de Gemini.

### 1.3 Strict Mode Opcional

**O quê:**
- Modo "strict" configurável por user
- HIGH risk → rewrite automático server-side antes de Gemini

**Como:**
```python
# Verificar plan (Free vs Pro) + user setting
if user_plan == "PRO" and strict_mode_enabled:
    if risk_level == "HIGH":
        sanitized_input = rewrite_pii(input_text, entities)
        gemini_input = sanitized_input
    else:
        gemini_input = input_text
else:
    gemini_input = input_text  # Free: apenas alerta, sem rewrite
```

**Critério:** Pro users em strict mode nunca enviam HIGH risk para Gemini.

### 1.4 Rewrite Enforcement

**O quê:**
- Garantir que payload final esteja sanitizado antes de LLM

**Critério:** Nenhum dado HIGH (CPF, API_KEY, JWT, etc) chega ao Gemini em strict mode.

### 1.5 Payload Interception Tests

**O quê:**
- Playwright tests que interceptam requests
- Validar que CPF/API_KEY/JWT foram reescritos

**Como:**
```typescript
// tests/e2e/dlp-protection.spec.ts
test('CPF HIGH + strict mode → rewrite before Gemini', async () => {
  const requests: any[] = [];
  page.on('request', r => requests.push(r));
  
  // Type CPF na textarea
  await page.fill('textarea', 'CPF 050.423.674-11');
  await page.click('[data-testid="atenna-btn"]');
  
  // Verify rewrite happened
  const genRequest = requests.find(r => r.url.includes('/generate-prompts'));
  expect(genRequest.body).not.toContain('050.423.674-11');
  expect(genRequest.body).toContain('[CPF]');
});
```

**Critério:** E2E tests provam que rewrite acontece antes de LLM.

### 1.6 advisory.ts Integration

**O quê:**
- Remover strings hardcoded de injectButton.ts
- Chamar `buildAdvisory()` e `getAdvisorySubtitle()` de advisory.ts

**Critério:** Não há strings duplicadas; advisory.ts é single source of truth.

### 1.7 Telemetry Real

**O quê:**
- Chamar `telemetry.warning_shown()` quando banner aparece
- Chamar `telemetry.send_override()` quando user clica "Enviar original"
- Chamar `telemetry.entities_rewritten()` quando rewrite acontece
- (Novo) `telemetry.process_detected()` quando CNJ é detectado

**Como:**
```python
def process_detected(
    entity_type: str,  # "PROCESS_NUM"
    risk_level: RiskLevel,
    score: float,
    session_id: str | None,
) -> None:
    _emit("dlp_process_detected", {
        "entity_type": entity_type,
        "risk_level": risk_level,
        "score": round(score, 4),
        "session_id": session_id,
    })
```

**Critério:** Todas as 4 funções chamadas no fluxo real.

### 1.8 pt_core_news_sm in Analyzer

**O quê:**
- Substituir `en_core_web_sm` por `pt_core_news_sm` no analyzer.py
- Ativar NLP português real (tokenização, NER)

**Como:**
```python
# backend/dlp/analyzer.py
provider = NlpEngineProvider(nlp_configuration={
    "nlp_engine_name": "spacy",
    "models": [
        {"lang_code": "pt", "model_name": "pt_core_news_sm"},  # ← mudar
        {"lang_code": "en", "model_name": "en_core_web_sm"},
    ],
})
```

**Instalação:** `pip install https://github.com/explosion/spacy-models/releases/download/pt_core_news_sm-3.7.0/pt_core_news_sm-3.7.0-py3-none-any.whl`

**Critério:** Presidio analisa em PT-BR nativo.

### 1.9 Timeout Safety

**O quê:**
- `/dlp/scan` timeout máximo 3 segundos
- Evitar bloqueio indefinido se spaCy travar

**Como:**
```python
# backend/routes/dlp.py
@router.post("/scan")
async def scan(request: ScanRequest, user: dict = Depends(require_auth)):
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(dlp.pipeline.run, request),
            timeout=3.0
        )
        return result
    except asyncio.TimeoutError:
        return ScanResponse(
            risk_level=RiskLevel.NONE,
            score=0,
            entities=[],
            advisory="DLP timeout",
            show_warning=False,
            duration_ms=3000,
        )
```

**Critério:** /dlp/scan nunca bloqueia por mais de 3s.

### 1.10 CHANGELOG Entry

**Critério:** v2.16.0 documenta: server-side enforcement, telemetry calls, pt_core_news_sm, strict mode.

---

## FASE 2 — TELEMETRIA + E2E (Validação Operacional)

**Objetivo:** Validar operacionalmente que o sistema funciona.

**Duração estimada:** 2–3 semanas

### 2.1 Playwright E2E Suite

**O quê:**
- Tests de browser real (não jsdom)
- Extension carregada
- Payload real interceptado
- Rewrite validado

**Arquivo:** `tests/e2e/dlp-full-flow.spec.ts`

**Testes obrigatórios:**
- ✅ CPF detectado → badge HIGH → rewrite → Gemini recebe [CPF]
- ✅ API_KEY detectado → banner aparece → user ignora → Gemini recebe bruto (Free)
- ✅ JWT detectado → strict mode → rewrite automático
- ✅ CNJ detectado → badge muda cor
- ✅ Nome em CAPS → detecção + rewrite
- ✅ Múltiplas entidades → rewrite todas

**Critério:** 6+ testes E2E cobrindo fluxo crítico.

### 2.2 Persistent Telemetry (DB)

**O quê:**
- Nova tabela Supabase: `dlp_events`
- Schema:

```sql
create table dlp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,  -- warning_shown | send_override | entities_rewritten
  risk_level text,
  entity_types text[],
  entity_count int,
  score float,
  override_reason text,
  timestamp timestamptz default now()
);

create index idx_dlp_events_user_ts on dlp_events(user_id, timestamp desc);
create index idx_dlp_events_risk on dlp_events(risk_level);
```

**Como:** Backend envia telemetria via Supabase REST ao gravar evento.

**Critério:** Eventos persistem por 90 dias; queryáveis por user/risk/entity.

### 2.3 Metrics Dashboard Básico

**O quê:**
- UI simples em `src/ui/metrics.ts` (opcional, não obrigatório para v2.16)
- Query tempos e agregações

**Métricas essenciais:**
- False positive rate (user marked como FP)
- Override rate (user enviou HIGH risk mesmo assim)
- HIGH frequency (quantos HIGH por dia)
- Latency p95/p99 client + server

**Critério:** Métricas agregadas disponivelizáveis (não precisa de UI ainda).

### 2.4 DlpStats Sync Finalizado

**O quê:**
- Aplicar migration `user_dlp_stats` no Supabase
- Validar que sync 2-way funciona

**Critério:** User vê contadores atualizados no settings (v2.14.0).

---

## FASE 3 — PT-BR ENTERPRISE (Recognizers Brasileiros)

**Objetivo:** Evoluir recognizers para contexto jurídico/administrativo/médico.

**Duração estimada:** 3–4 semanas

### 3.1 RG Recognizer

**O quê:** Regex + validator aritmético (dígito verificador)

**Padrão:** `\b\d{1,2}[.]?\d{3}[.]?\d{3}[-]?\d{2}\b`

**Validator:** Dígito verificador (algoritmo RG oficial)

**Implementar em:** `patterns.ts` (client) + `analyzer.py` (server)

### 3.2 CNH Recognizer

**O quê:** Regex + validator Luhn

**Padrão:** `\b\d{11}\b` (CNH sempre 11 dígitos)

**Validator:** Luhn check

### 3.3 Placa BR Recognizer

**O quê:** Padrão antigo + Mercosul novo

**Padrão antigo:** `\b[A-Z]{3}-\d{4}\b`  
**Padrão novo:** `\b[A-Z]{3}\d[A-Z]\d{2}\b`

### 3.4 CEP Enriquecido

**O quê:** Não apenas regex; mapear para bairro/cidade

**Padrão:** `\b\d{5}-\d{3}\b`

**Contexto:** "CEP 01310-100 (Av Paulista, São Paulo)" → risco maior

### 3.5 Endereço BR

**O quê:** Rua/número/bairro/cidade + CEP

**Padrão:** Heurística — palavras-chave + formatos comuns

### 3.6 OAB Recognizer

**O quê:** Registro de advogado

**Padrão:** `\b\d{6}\/[A-Z]{2}\b` (6 dígitos + estado)

### 3.7 Padrões Jurídicos

**O quê:** Identificadores jurídicos (não CNJ)

**Exemplos:**
- Artigo + lei: "Art. 5º da CF/88"
- Dispositivo: "§1º"
- Sentença: "Sentença nº 123/2023"

### 3.8 Padrões Médicos

**O quê:** Identificadores médicos (não dados pessoais)

**Exemplos:**
- CRM: `\b\d{4,6}\/[A-Z]{2}\b`
- Medicamento + dosagem
- Código ICD-10

---

## FASE 4 — DOCUMENT PIPELINE (Upload Seguro)

**Objetivo:** Proteger uploads de documentos.

**Duração estimada:** 4–6 semanas

### 4.1 PDF Extraction

**Tool:** PyMuPDF (`pip install pymupdf`)

```python
# backend/dlp/document.py
import fitz

def extract_pdf(file_bytes: bytes) -> str:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return text
```

### 4.2 DOCX Extraction

**Tool:** python-docx (`pip install python-docx`)

```python
from docx import Document
from io import BytesIO

def extract_docx(file_bytes: bytes) -> str:
    doc = Document(BytesIO(file_bytes))
    return "\n".join([p.text for p in doc.paragraphs])
```

### 4.3 scan-document Endpoint

**O quê:**
```python
@router.post("/scan-document")
async def scan_document(
    file: UploadFile,
    user: dict = Depends(require_auth)
) -> DocumentScanResponse:
    content = await file.read()
    if file.filename.endswith('.pdf'):
        text = extract_pdf(content)
    elif file.filename.endswith('.docx'):
        text = extract_docx(content)
    else:
        raise HTTPException(400, "Only PDF/DOCX")
    
    results = analyze(text)
    return DocumentScanResponse(
        filename=file.filename,
        entities=[...],
        risk_level=...,
        pages=[...],  # página + offset
    )
```

### 4.4 Entity Mapping (página + offset)

**O quê:** Rastrear onde no documento cada entidade aparece

```python
class DocumentEntity(BaseModel):
    type: str
    value: str
    page: int
    offset_in_page: int
    context_snippet: str  # 50 chars ao redor
```

### 4.5 Document Rewrite

**O quê:** Rewrite em-place no PDF/DOCX

```python
def rewrite_document(
    file_bytes: bytes,
    entities: list[DocumentEntity],
    filetype: str
) -> bytes:
    if filetype == "pdf":
        return rewrite_pdf(file_bytes, entities)
    elif filetype == "docx":
        return rewrite_docx(file_bytes, entities)
```

### 4.6 Upload UX

**O quê:** Modal em `src/ui/upload.ts`

- Arrastar PDF/DOCX
- Mostrar scan result
- "Protect Document" → rewrite → download
- Progress bar

**Critério:** Documento reescrito antes de user fazer download.

---

## FASE 5 — OCR + IMAGE DLP (Multimodal Básico)

**Objetivo:** Proteger imagens com dados sensíveis.

**Duração estimada:** 6–8 semanas

### 5.1 OCR Engine

**Tool:** EasyOCR (`pip install easyocr`)

```python
# backend/dlp/ocr.py
import easyocr

reader = easyocr.Reader(['pt', 'en'])

def ocr_image(image_bytes: bytes) -> str:
    image = Image.open(BytesIO(image_bytes))
    results = reader.readtext(image)
    return "\n".join([text for (_, text, _) in results])
```

### 5.2 presidio-image-redactor

**Tool:** `pip install presidio-image-redactor`

```python
from PIL import Image
from presidio_image_redactor import ImageRedactorEngine

engine = ImageRedactorEngine()

def redact_image(image_bytes: bytes, entities: list) -> bytes:
    image = Image.open(BytesIO(image_bytes))
    # Redact using presidio bounding boxes
    redacted = engine.redact(image, analyzer_results=entities)
    return redacted.tobytes()
```

### 5.3 Image Masking

**O quê:** Substituir áreas sensíveis por retângulos mascarados

**Tool:** Pillow (`PIL.Image`)

### 5.4 EXIF Cleanup

**Tool:** Pillow + piexif (`pip install piexif`)

```python
def strip_exif(image_bytes: bytes) -> bytes:
    image = Image.open(BytesIO(image_bytes))
    data = list(image.getdata())
    image_without_exif = Image.new(image.mode, image.size)
    image_without_exif.putdata(data)
    return image_without_exif.tobytes()
```

### 5.5 scan-image Endpoint

**O quê:**
```python
@router.post("/scan-image")
async def scan_image(
    file: UploadFile,
    user: dict = Depends(require_auth)
) -> ImageScanResponse:
    image_bytes = await file.read()
    text = ocr_image(image_bytes)
    entities = analyze(text)
    
    return ImageScanResponse(
        filename=file.filename,
        entities=[...],
        risk_level=...,
        ocr_text=text,
    )
```

### 5.6 Image Redaction UI

**O quê:** Modal de redação antes de usar imagem

- Upload
- OCR preview
- Detectedentities highlighted
- "Redact" → mascarar
- Download redacted image

**Critério:** Imagem redacted antes de ir para qualquer lugar.

---

## FASE 6 — MULTIMODAL ENTERPRISE (Governance Layer)

**Objetivo:** Camada enterprise com compliance + audit.

**Duração estimada:** 8–12 semanas

### 6.1 Classificação Automática

**O quê:** DLP automático classifica documento por tipo

**Tipos:**
- PII (Personal ID)
- Financial (Bank, Card, Invoice)
- Medical (Patient data)
- Legal (Contract, Ruling)
- Technical (API, Credentials)

**Como:** Heurística simples baseada em entities encontradas.

### 6.2 Sensibilidade Documental

**O quê:** Score de sensibilidade 0-100 por documento

**Fatores:**
- Quantidade de HIGH risk entities
- Tipos de entidade
- Contexto (médico = mais sensível)

### 6.3 Compliance Dashboard

**O quê:** UI em `src/ui/compliance-dashboard.ts`

**Métricas:**
- Documentos escaneados (últimos 30 dias)
- Documentos HIGH risk encontrados
- Documentos reescritos com sucesso
- Taxa de false positives

### 6.4 Audit Trail

**O quê:** Log imutável de todas as ações DLP

**Schema:**
```sql
create table dlp_audit_log (
  id uuid primary key,
  user_id uuid references auth.users(id),
  action text,  -- scan | rewrite | override | false_positive
  resource_type text,  -- document | image | text
  resource_id text,
  entities_found int,
  risk_level text,
  timestamp timestamptz
);
```

### 6.5 Retention Policies

**O quê:** Configurar retenção de dados por tipo

**Exemplo:**
- PII: 30 dias
- Medical: 90 dias
- Legal: 7 anos

### 6.6 Forensic Logs

**O quê:** Logs completos para investigação (não agregados)

**O que guardar:**
- Input original (com hash)
- Entidades encontradas (com offsets)
- Rewrite result
- User override reason
- IP + timestamp

### 6.7 Department Policies

**O quê:** Diferentes regras DLP por departamento

**Exemplo:**
- Legal department: strict mode obrigatório
- Marketing: Low risk apenas
- Engineering: API_KEY → rewrite automático

### 6.8 Governance Layer

**O quê:** Admin console para configurar policies

**Recursos:**
- Criar/editar policies
- Assign to departments
- Monitor compliance
- Export audit logs

---

## REGRAS ABSOLUTAS

### NÃO fazer:

❌ Adicionar gamificação ("protect your privacy streak!")  
❌ Adicionar IA "emocional" (reações ChatGPT-style)  
❌ Adicionar complexidade visual (3D charts, animations)  
❌ Transformar Atenna em antivírus (alarmes, flags, rejeições)  
❌ Usar UX alarmista ("CRITICAL THREAT", "IMMEDIATE ACTION REQUIRED")  
❌ Usar compliance agressivo (bloqueio, nenhuma alternativa)  

### SIM fazer:

✅ Proteção invisível (silent rewrite, sem interrupção)  
✅ Experiência premium (elegante, confiável, rápida)  
✅ Contexto brasileiro (nomes BR, jurídico, médico)  
✅ Simplicidade (regex + heurística > LLM pesado)  
✅ Velocidade (client-side realtime, <50ms)  
✅ Baixo atrito (opt-in protection, não bloqueio)  

---

## MÉTRICA PRINCIPAL

A principal métrica do Atenna DLP é:

> **"Quantidade de dados sensíveis protegidos antes de chegar ao modelo LLM"**

### Não otimizar para:
- Quantidade de prompts gerados
- Tempo de sessão
- Gamificação/streaks
- Onboarding completion rate

### Sim otimizar para:
- CPF/CNPJ/API_KEY/JWT detectados vs. vazados
- Taxa de rewrite bem-sucedido
- FALSE POSITIVE rate (precisão do detector)
- Latência (client-side: <50ms, server: <3s)

---

## STATUS MATRIX (v2.15.0)

| Component | Phase | Status | Notes |
|---|---|---|---|
| Client-side detector | - | ✅ IMPLEMENTADO | 41 testes, <50ms |
| Advisory banner | - | ✅ IMPLEMENTADO | Com botões, dismiss |
| rewritePII() | - | ✅ IMPLEMENTADO | Tokens semânticos |
| CPF/CNPJ validators | - | ✅ IMPLEMENTADO | Digit verification |
| API_KEY (6 providers) | - | ✅ IMPLEMENTADO | Regex + context |
| JWT/Bearer | - | ✅ IMPLEMENTADO | 3-segment validation |
| CNJ detection | - | ✅ IMPLEMENTADO (client) | Server ausente |
| Auth gate | - | ✅ IMPLEMENTADO | JWT obrigatório |
| Presidio VPS | - | ✅ IMPLEMENTADO | Docker running |
| /dlp/scan endpoint | - | ✅ IMPLEMENTADO | Sem cliente |
| Semantic hints | - | ✅ IMPLEMENTADO | 7+ contexts |
| Badge + dot | - | ✅ IMPLEMENTADO | Drag, colors |
| DLP Stats | - | ⚠️ PARCIAL | Migration pending |
| /generate-prompts awareness | 1 | ✅ IMPLEMENTADO | v2.16.0 — Task 1 |
| Server-side revalidation | 1 | ⏳ PENDENTE | Re-analyze HIGH |
| Strict mode | 1 | ⏳ PENDENTE | Pro feature |
| advisory.ts integration | 1 | ✅ IMPLEMENTADO | v2.16.0 — Task 2 |
| Telemetry calls | 1 | ⏳ PENDENTE | warning_shown, etc |
| pt_core_news_sm | 1 | ⏳ PENDENTE | NLP PT-BR |
| Timeout safety | 1 | ⏳ PENDENTE | 3s max |
| Playwright E2E | 2 | ⏳ PENDENTE | 6+ tests |
| Persistent telemetry | 2 | ⏳ PENDENTE | dlp_events table |
| Metrics dashboard | 2 | ⏳ PENDENTE | UI opcional |
| RG recognizer | 3 | 📋 ROADMAP | Phase 3 |
| CNH recognizer | 3 | 📋 ROADMAP | Phase 3 |
| Placa BR | 3 | 📋 ROADMAP | Phase 3 |
| Document pipeline | 4 | 📋 ROADMAP | Phase 4 |
| PDF/DOCX parsing | 4 | 📋 ROADMAP | PyMuPDF + python-docx |
| OCR + image DLP | 5 | 📋 ROADMAP | Phase 5 |
| Compliance dashboard | 6 | 📋 ROADMAP | Phase 6 |
| **DLP types/scanner/classification** | **4.2A** | **✅ IMPLEMENTADO** | **v2.27.0 — 18 entidades, validadores aritméticos** |
| **DLP policy engine** | **4.2A** | **✅ IMPLEMENTADO** | **v2.27.0 — block/mask/alert, strict_mode, combined risk** |
| **DLP governance matrix** | **4.2A** | **✅ IMPLEMENTADO** | **v2.27.0 — 5 níveis LGPD, ModelConstraint, AuditLevel** |
| **Audit hash chain** | **4.2A** | **✅ IMPLEMENTADO** | **v2.27.0 — SHA-256 encadeado, 9 event types** |
| **Outbound security allowlist** | **4.2A** | **✅ IMPLEMENTADO** | **v2.27.0 — assert_safe_llm_url em openai+gemini** |
| **Placeholders canônicos (frontend)** | **4.2A** | **✅ IMPLEMENTADO** | **v2.27.0 — rewriter.ts alinhado com types.py** |
| **79 testes unitários DLP** | **4.2A** | **✅ IMPLEMENTADO** | **v2.27.0 — 79/79 GREEN** |
| PDF/DOCX pipeline com DLP | 4.2B | ⏳ PRÓXIMA FASE | pdf_parser + docx_parser + endpoint + rewrite |

---

## IMPORTANTE

**Este documento é:** SOURCE OF TRUTH para o roadmap DLP do Atenna.

**Qualquer mudança requer:**
- Aprovação explícita
- Justificativa técnica
- Update nesta página
- Git commit com referência

**Após cada milestone:**
1. Atualizar status matrix
2. Marcar itens como IMPLEMENTADO/PARCIAL/STUB/ROADMAP
3. Criar CHANGELOG entry
4. Deploy em produção

---

## CONTATO + APROVALIZAÇÃO

- **Tech Owner:** Diego Rodrigues (devdiegopro@gmail.com)
- **Last Review:** 2026-05-07
- **Next Review:** 2026-06-07 (após Phase 1)

---

**Generated from technical audit:** `docs/auditorias/DLP_TECHNICAL_AUDIT_20260507.md`
