# FASE 4.2B — MATRIZ DE LIMITES: Document Pipeline Security

**Data:** 2026-05-13  
**Status:** APROVADO — obrigatório antes de qualquer código de parsing  
**Princípio:** PDF parsing é superfície de ataque real. Sem limites explícitos = vetor de DoS na VPS.

---

## 1. LIMITES ABSOLUTOS (hard limits — não configuráveis por usuário)

| Limite | Valor | Justificativa |
|---|---|---|
| `MAX_UPLOAD_SIZE_BYTES` | `10_485_760` (10 MB) | Evita saturação de disco e RAM no container |
| `MAX_PAGES` | `50` | Parser bomb: PDFs com 10k páginas existem na wild |
| `MAX_CHARS_EXTRACTED` | `500_000` | 500 KB texto: ~250 páginas densas; acima disso DLP fica lento |
| `MAX_EXTRACTION_TIME_SECS` | `8.0` | Limite hard; 3s é o esperado; 8s é timeout de segurança |
| `MAX_MEMORY_MB` (por request) | `80` | Container tem 512MB; 80MB por parse = headroom seguro |
| `MAX_CHUNKS` | `100` | Chunking do texto para DLP; 100 × 5000 chars = 500K |
| `CHUNK_SIZE_CHARS` | `5_000` | Janela de DLP por chunk; balanceia latência × cobertura |
| `MAX_CONCURRENT_PARSES` | `3` | Semáforo async; evita 10 requests simultâneos travarem a VPS |
| `MIN_FILE_SIZE_BYTES` | `64` | Abaixo disso: arquivo vazio / truncado |

---

## 2. POLÍTICA POR TIPO DE ARQUIVO

### 2.1 PDF Textual (texto extraível via pdfplumber/pypdf)

| Condição | Resposta | HTTP |
|---|---|---|
| Normal, dentro dos limites | Extrair → DLP → retornar findings | 200 |
| Acima de MAX_PAGES | Truncar nas primeiras 50 páginas + aviso no response | 200 + `truncated: true` |
| Acima de MAX_CHARS_EXTRACTED | Truncar em 500K chars + aviso | 200 + `truncated: true` |
| Timeout de extração | Retornar erro seguro, limpar buffer | 408 |
| Malformed / corrompido | Capturar exceção, retornar erro seguro SEM stack trace | 422 |
| Acima de MAX_UPLOAD_SIZE | Rejeitar ANTES de ler o body | 413 |

### 2.2 PDF Encriptado / Protegido por senha

| Condição | Resposta | HTTP |
|---|---|---|
| PDF requer senha | Rejeitar imediatamente — NÃO tentar decriptar | 422 `encrypted_pdf` |
| PDF com permissões restritas (sem extração de texto) | Rejeitar — NÃO tentar OCR automático | 422 `restricted_pdf` |

**Razão:** Tentar decriptar PDFs encriptados é vetor de timing attack e abre superfície para senhas bruteforce via API.

### 2.3 PDF Baseado em Imagem (scanned, sem texto extraível)

| Condição | Resposta | HTTP |
|---|---|---|
| PDF scan sem texto (≤ 10 chars extraídos) | Retornar `scan_only: true` + aviso "OCR não disponível nesta versão" | 200 |
| OCR flag habilitado (FASE 4.3) | Encaminhar para pipeline OCR (fora do escopo 4.2B) | — |

**Razão:** OCR = FASE 4.3. Na 4.2B, scanned PDFs são aceitos mas retornam resultado vazio com aviso explícito — nunca erro silencioso.

### 2.4 DOCX

| Condição | Resposta | HTTP |
|---|---|---|
| Normal, dentro dos limites | Extrair parágrafos → DLP → retornar findings | 200 |
| DOCX com macros VBA | Extrair texto apenas — ignorar macros | 200 |
| DOCX corrompido / ZIP inválido | Capturar exceção, retornar erro seguro | 422 |
| DOCX com imagens embutidas | Ignorar imagens — texto only | 200 |
| Acima de MAX_UPLOAD_SIZE | Rejeitar ANTES de ler o body | 413 |

### 2.5 Tipos não suportados

| Tipo | Resposta |
|---|---|
| `.xls`, `.xlsx`, `.pptx` | 415 `unsupported_type` |
| `.exe`, `.zip`, `.tar` | 415 `unsupported_type` |
| MIME spoof (extensão ≠ magic bytes) | 422 `mime_mismatch` |
| Arquivo vazio (< 64 bytes) | 422 `file_too_small` |

---

## 3. PARSER BOMB DEFENSES

### 3.1 ZIP Bomb (DOCX é ZIP)

DOCX é um arquivo ZIP. Um ZIP bomb pode ter 1KB comprimido → 1GB descomprimido.

**Defesa:**
- Verificar tamanho descomprimido antes de extrair: se > `MAX_UPLOAD_SIZE × 10` → rejeitar
- Usar `python-docx` com stream limitado (não carregar tudo na RAM)
- Timeout na extração via `asyncio.wait_for`

### 3.2 PDF com muitos objetos (object flood)

PDFs maliciosos podem ter 100k objetos internos para travar o parser.

**Defesa:**
- `pdfplumber` tem limite interno de objetos; wrapper com timeout de 8s
- Se `len(pages) > MAX_PAGES`, parar na página 50 — nunca percorrer tudo

### 3.3 Deeply Nested PDF Streams

PDFs com streams comprimidos dentro de streams.

**Defesa:**
- `pdfplumber` descomprime automaticamente, mas com timeout externo via thread
- Capturar `RecursionError` e `MemoryError` explicitamente

### 3.4 Text Extraction Inflation

Um PDF pode ter 3 páginas mas 10MB de texto (via repetição de objetos).

**Defesa:**
- Truncar extração em `MAX_CHARS_EXTRACTED` durante o loop de páginas
- Nunca concatenar texto sem verificar comprimento acumulado

---

## 4. MEMORY SAFETY

### 4.1 Lifecycle dos buffers

```
request body chegou
    ↓
validar tamanho (< 10MB) — rejeitar se exceder
    ↓
bytes → parser (em thread separada, timeout 8s)
    ↓
texto extraído (str) — truncar se > 500K chars
    ↓
del file_bytes (liberar buffer original)
    ↓
DLP scan em chunks de 5K chars
    ↓
del extracted_text (liberar texto completo)
    ↓
retornar apenas findings (sem conteúdo)
    ↓
GC implícito ao fim do request
```

### 4.2 Regras de cleanup

- `del file_bytes` OBRIGATÓRIO após parsing (antes do DLP)
- `del extracted_text` OBRIGATÓRIO após chunking (antes de retornar)
- Nunca incluir `extracted_text` no response JSON — apenas findings
- `gc.collect()` após cada parse de arquivo grande (> 1MB)

---

## 5. FEATURE FLAG GATE

```python
DOCUMENT_UPLOAD_ENABLED = False  # padrão — nunca True em produção sem stress harness
```

- O endpoint `/upload-document` retorna `503` se flag `DOCUMENT_UPLOAD_ENABLED=false`
- A flag é lida de `DOCUMENT_UPLOAD_ENABLED` env var (default `false`)
- **Não ativar em produção até stress harness passar 100%**

---

## 6. STRESS / ABUSE HARNESS (obrigatório antes do deploy)

Todos estes cenários devem passar antes de qualquer rollout:

| Cenário | Arquivo de teste | Critério |
|---|---|---|
| PDF válido, 10 páginas | `tests/fixtures/normal_10p.pdf` | 200, findings corretos |
| PDF com CPF/CNPJ/API_KEY | `tests/fixtures/pii_sample.pdf` | findings detectados, texto não no response |
| PDF 51 páginas | `tests/fixtures/large_51p.pdf` | 200, `truncated: true`, apenas 50 páginas |
| PDF encriptado | `tests/fixtures/encrypted.pdf` | 422, `encrypted_pdf` |
| PDF malformado / corrompido | `tests/fixtures/malformed.pdf` | 422, sem stack trace |
| PDF scan (0 texto) | `tests/fixtures/scanned.pdf` | 200, `scan_only: true`, 0 findings |
| PDF > 10MB | gerado em memória | 413 antes do parse |
| DOCX válido | `tests/fixtures/normal.docx` | 200, findings corretos |
| DOCX com macros | `tests/fixtures/with_macros.docx` | 200, macros ignoradas |
| DOCX corrompido | `tests/fixtures/malformed.docx` | 422 |
| ZIP bomb simulado | arquivo com alta razão compressão | 422 ou 413 |
| Timeout (parse lento simulado) | mock `pdfplumber` com sleep 9s | 408 |
| 3 requests simultâneos | asyncio gather | todos respondem sem crash |
| 4º request simultâneo | asyncio gather | 503 `capacity_exceeded` |
| MIME spoof (.pdf com bytes de .exe) | arquivo criado manualmente | 422 `mime_mismatch` |

---

## 7. RESPONSE CONTRACT

O endpoint `/upload-document` NUNCA retorna:
- O texto extraído do documento
- Fragmentos do conteúdo
- Stack traces ou mensagens de erro internas

O endpoint SEMPRE retorna apenas:
```json
{
  "filename": "relatorio.pdf",
  "file_size_bytes": 204800,
  "pages_parsed": 10,
  "chars_extracted": 12400,
  "truncated": false,
  "scan_only": false,
  "findings": [...],
  "risk_level": "HIGH",
  "blocked": false,
  "masked_summary": "[CPF] encontrado na página 3"
}
```

---

## 8. CRITÉRIO DE APROVAÇÃO FASE 4.2B

- [ ] `backend/document/limits.py` — constantes definidas e usadas em todo o pipeline
- [ ] `backend/document/parsers/pdf_parser.py` — extração segura com todos os guards
- [ ] `backend/document/parsers/docx_parser.py` — extração segura com ZIP bomb defense
- [ ] `backend/document/sanitizer.py` — memory cleanup, chunking, del explícito
- [ ] `backend/routes/upload.py` — endpoint com feature flag gate
- [ ] `tests/backend/test_document_abuse.py` — 15 cenários do harness passando
- [ ] Feature flag `DOCUMENT_UPLOAD_ENABLED=false` por padrão
- [ ] Zero texto extraído no response (apenas findings)
- [ ] Timeout de 8s funcional (testado com mock)
- [ ] CHANGELOG v2.28.0
- [ ] **Deploy SÓ após aprovação explícita do harness**

---

*Este documento é pré-requisito para qualquer linha de código de parsing.*  
*Qualquer mudança nos limites requer aprovação explícita.*
