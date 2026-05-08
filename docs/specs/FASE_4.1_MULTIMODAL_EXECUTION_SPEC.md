# FASE 4.1 — Multimodal Implementation Spec

**Versão:** 1.0  
**Status:** 📋 Spec Executável (Aguardando Aprovação)  
**Data:** 2026-05-08  
**Escopo:** Arquivos leves apenas (TXT, MD, CSV, JSON)  
**Objetivo:** Pipeline multimodal mínimo com segurança máxima

---

## Princípio Central

```
Validar pipeline multimodal seguro usando apenas arquivos leves.
Nenhum arquivo bruto para o provider.
Nenhum conteúdo bruto persistido.
Segurança máxima, UX mínima, risco operacional baixo.
```

---

## 1. Visão Operacional

### O Problema
Usuários têm textos em arquivos (TXT, CSV, notas MD) que querem processar com Atenna.
Risco: enviar arquivo inteiro com PII para IA.

### A Solução
1. Upload de arquivo leve
2. Extração segura em memória
3. DLP scan (mesmo engine)
4. Rewrite se necessário
5. Envio sanitizado ou original (user choice)
6. Cleanup automático

### Não É
- ❌ Persistência de documentos
- ❌ Histórico de uploads
- ❌ Compartilhamento de arquivos
- ❌ OCR
- ❌ Análise de imagens

### É
- ✅ One-shot upload
- ✅ DLP realtime
- ✅ Sanitização before provider
- ✅ Cleanup automático
- ✅ Audit sem conteúdo

---

## 2. Escopo Exato

### Suportados (FASE 4.1 Apenas)

| Tipo | Extensão | Max Size | Encoding | Exemplo |
|---|---|---|---|---|
| Plain Text | `.txt` | 1 MB | UTF-8 | notas.txt |
| Markdown | `.md` | 1 MB | UTF-8 | readme.md |
| CSV | `.csv` | 5 MB | UTF-8 | dados.csv |
| JSON | `.json` | 1 MB | UTF-8 | config.json |

**Máximos Globais:**
- Total chars extraído: 100.000 caracteres (100k)
- Max 1 arquivo simultâneo
- Max 1 upload por sessão (cleanup automático)

### NÃO Suportados (Futuro)
- ❌ `.pdf` (FASE 4.2)
- ❌ `.docx` (FASE 4.2)
- ❌ Imagens (FASE 4.3+)
- ❌ `.zip`, `.rar` (nunca)
- ❌ Arquivos binários

### Encoding
- ✅ UTF-8
- ✅ ASCII
- ✅ Latin-1 (com fallback)
- ❌ Outros (erro "Encoding não suportado")

---

## 3. Fluxo Completo do Usuário

### Normal Path (Sem Alto Risco)

```
1. User abre Settings → seção "Documentos"
   "Compartilhe documentos com IA"
   
   UI: 
   ┌────────────────────────────────────┐
   │ 📎 Compartilhe documentos com IA    │
   │ TXT · MD · CSV · JSON · Máx 1 MB    │
   │                                    │
   │   [ Selecionar arquivo ]           │
   │   ou arraste aqui                  │
   └────────────────────────────────────┘

2. User clica [Selecionar arquivo]
   → File picker abre
   
3. User seleciona notas.txt (500 KB)
   → Widget mostra:
   
   ┌────────────────────────────────────┐
   │ 📎 Enviando notas.txt...           │
   │ ▓▓▓▓▓▓░░░░░░ 60%                   │
   │ (400 KB de 500 KB)                 │
   └────────────────────────────────────┘

4. Upload completa
   → Backend escaneia conteúdo
   
   ┌────────────────────────────────────┐
   │ 🔍 Analisando dados...             │
   │ Verificando conteúdo sensível      │
   └────────────────────────────────────┘

5. Análise completa
   → Risco NONE ou LOW
   → Mostra preview seguro
   
   ┌────────────────────────────────────┐
   │ ✓ Pronto para enviar               │
   │                                    │
   │ notas.txt (500 KB)                 │
   │ 15.234 caracteres                  │
   │ Nenhum dado sensível detectado.    │
   │                                    │
   │   [ Enviar para IA ]               │
   │   [ Compartilhar outra ]           │
   └────────────────────────────────────┘

6. User clica [Enviar para IA]
   → Conteúdo é enviado
   → Modal se fecha
   → (User entra em chat com arquivo)
```

### High Risk Path

```
1-4. [Idem acima]

5. Análise completa
   → Risco HIGH
   → Mostra entidades detectadas
   
   ┌────────────────────────────────────┐
   │ ⚠️ Dados sensíveis detectados      │
   │                                    │
   │ 3 possíveis dados sensíveis:       │
   │ CPF · Email · API Key              │
   │                                    │
   │   [ Proteger dados ]               │
   │   [ Enviar original ]              │
   └────────────────────────────────────┘

6a. User clica [Proteger dados]
    → Rewrite PII automaticamente
    → Mostra preview protegido
    
    ┌────────────────────────────────────┐
    │ ✓ Dados protegidos                 │
    │                                    │
    │ Conteúdo sanitizado e pronto.      │
    │ 3 dados sensíveis foram mascarados │
    │ (CPF → [CPF], Email → [EMAIL])     │
    │                                    │
    │   [ Enviar conteúdo protegido ]    │
    │   [ Compartilhar outra ]           │
    └────────────────────────────────────┘
    
    → User clica [Enviar conteúdo protegido]
    → Conteúdo reescrito é enviado

6b. Ou user clica [Enviar original]
    → Modal se fecha
    → (User sabe que está enviando alto risco)
```

### Error Paths

#### Arquivo Inválido
```
User seleciona .exe

┌────────────────────────────────────┐
│ ❌ Tipo de arquivo não suportado   │
│                                    │
│ Suportamos: TXT, MD, CSV, JSON     │
│ Máximo: 1 MB                       │
│                                    │
│   [ Tentar outro ]                 │
└────────────────────────────────────┘
```

#### Arquivo Muito Grande
```
User seleciona 10MB CSV

┌────────────────────────────────────┐
│ ❌ Arquivo muito grande            │
│                                    │
│ Máximo: 5 MB para CSV              │
│ Seu arquivo: 10 MB                 │
│                                    │
│   [ Tentar outro ]                 │
└────────────────────────────────────┘
```

#### Encoding Inválido
```
Backend detecta encoding não suportado

┌────────────────────────────────────┐
│ ❌ Arquivo corrompido ou encoding  │
│                                    │
│ Não conseguimos ler este arquivo.  │
│ Suportamos UTF-8, ASCII, Latin-1   │
│                                    │
│   [ Tentar outro ]                 │
└────────────────────────────────────┘
```

#### Timeout
```
File > 100k chars, scan > 10s

┌────────────────────────────────────┐
│ ⏱ Análise demorou muito            │
│                                    │
│ Tente um arquivo menor ou tente    │
│ novamente em alguns momentos.      │
│                                    │
│   [ Tentar outro ]                 │
└────────────────────────────────────┘
```

---

## 4. Fluxo Técnico Interno

### Backend Pipeline (Sequencial)

```python
async def process_document_upload(file: UploadFile, user_id: str):
    """
    Internal pipeline — must not fail silently.
    All steps are tracked for audit.
    """
    
    # STEP 1: Validate file
    # ├─ Check size (max 1-5 MB by type)
    # ├─ Check MIME type
    # ├─ Check magic bytes
    # └─ Extract extension safely
    
    validation = await validate_file(file)
    if not validation.valid:
        return {
            "success": False,
            "error": validation.error_message,
            "status_code": 400,
        }
    
    # STEP 2: Extract content safely (memory only)
    # ├─ Read file into memory
    # ├─ Detect encoding
    # ├─ Normalize text (remove BOM, control chars)
    # └─ Validate size after extraction
    
    content = await extract_content(file.file, validation.file_type)
    if len(content) > MAX_CHARS:
        return {
            "success": False,
            "error": f"Arquivo muito grande ({len(content)} chars > {MAX_CHARS})",
        }
    
    # STEP 3: DLP scan
    # ├─ Use existing dlp_engine.analyze()
    # ├─ Pass session_id for telemetry
    # └─ Get risk_level + entities
    
    dlp_analysis = await dlp_engine.analyze(content, session_id)
    
    # STEP 4: Decision logic
    # ├─ If NONE/LOW → ready to use
    # ├─ If HIGH → return entities for UI to show banner
    
    # STEP 5: Prepare response
    return {
        "success": True,
        "dlp_risk_level": dlp_analysis.risk_level,
        "entity_count": len(dlp_analysis.entities),
        "entity_types": dlp_analysis.entity_types,
        "content_preview": content[:500],  # masked
        "content_hash": hash(content),  # for dedup
        "character_count": len(content),
    }
    
    # NEVER persist: raw file, raw content, entity values
    # DELETE from memory after response sent
```

### Key Constraints

1. **No File Persistence**
   - File never written to disk
   - Content never persisted to DB (only hash + metadata)
   - Memory freed immediately after response

2. **Extracted Content Handling**
   - Extracted in memory only
   - Max 100k chars enforced
   - Deleted after DLP scan
   - Hash kept for audit only

3. **DLP Integration**
   - Same engine as text (no special rules yet)
   - Session-tracked for telemetry
   - Timeout: 10 seconds max
   - On timeout → return UNKNOWN risk (not HIGH)

---

## 5. Lifecycle do Arquivo

### Timeline

```
T+0s   │ File selected
       │ ↓ User uploads
       │
T+1s   │ Backend receives
       │ ├─ Validation (type, size, magic bytes)
       │ ├─ Content extraction (memory only)
       │ ├─ Normalization (encoding, whitespace)
       │ └─ Size enforcement (100k chars max)
       │
T+2s   │ DLP scan starts
       │ ├─ Tokenization
       │ ├─ Entity detection (NLP + regex)
       │ └─ Risk classification
       │
T+3-5s │ DLP scan completes
       │ ├─ Response sent to frontend
       │ ├─ Content hash stored for audit
       │ └─ Raw content DELETED from memory
       │
T+5s+  │ Frontend shows result
       │ ├─ If HIGH risk → show banner
       │ ├─ User chooses action:
       │ │  ├─ [Proteger dados] → server rewrite
       │ │  └─ [Enviar original] → as-is
       │ │
       │ └─ Content sent to provider (or user cancels)
       │
T+final│ Cleanup
       │ ├─ Content removed from browser cache
       │ ├─ Session file reference cleared
       │ └─ No trace remains
```

### State Diagram

```
┌─────────────┐
│  IDLE       │  (waiting for file)
│ (init state)│
└──────┬──────┘
       │ file selected
       ▼
┌──────────────────┐
│  UPLOADING       │  (multipart upload)
└──────┬───────────┘
       │ upload complete
       ▼
┌──────────────────┐
│  VALIDATING      │  (type, size, encoding)
└──────┬───────────┘
       │ pass
       ▼
┌──────────────────┐
│  EXTRACTING      │  (text from file)
└──────┬───────────┘
       │ success
       ▼
┌──────────────────┐
│  DLP_SCANNING    │  (entity detection)
└──────┬───────────┘
       │ complete
       ▼
┌──────────────────┐
│  READY           │  (show result)
│ ├─ No Risk       │  → [Enviar para IA]
│ ├─ High Risk     │  → [Proteger] [Enviar original]
│ └─ Error         │  → [Tentar outro]
└──────┬───────────┘
       │ user action
       ▼
┌──────────────────┐
│  PROCESSING      │  (rewrite if needed)
└──────┬───────────┘
       │ complete
       ▼
┌──────────────────┐
│  CLEANUP         │  (memory wipe, cache clear)
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  IDLE (final)    │  (ready for next upload)
└──────────────────┘
```

### Transitions & Cleanup

| From | To | Cleanup Action |
|---|---|---|
| IDLE → UPLOADING | Cancel | (none) |
| UPLOADING → VALIDATING | Fail | Delete temp file |
| VALIDATING → EXTRACTING | Fail | (none) |
| EXTRACTING → DLP_SCANNING | Fail | Delete extracted content |
| DLP_SCANNING → READY | Complete | Keep hash only |
| READY → PROCESSING | Rewrite | Keep hash + user choice |
| PROCESSING → CLEANUP | Complete | Delete all memory |
| CLEANUP → IDLE | Final | Ready for next upload |

---

## 5.1 Badge Upload Entry Point

### Objetivo

Expor o ponto de entrada para upload multimodal **sem poluir a interface** da extensão. A experiência deve ser:
- **Compacta**: Badge padrão 42px circular (estado idle)
- **Acessível**: Aparece ao hover, intuitiva
- **Discreta**: Sem botões flutuantes adicionais, sem emoji grosseiro, sem aviso alarming
- **Gated**: Feature flag controla visibilidade até implementação real

---

### Comportamento Visual

#### Estado IDLE (Repouso)

```
Badge normal: 42px circular verde com ícone "shield"
Posição: canto inferior direito da textarea (persistente)
Visibilidade: Sempre visível (FASE 3.1B fix)
Clicável: Abre modal principal de configurações
```

#### Estado HOVER (Mouse over badge)

```
Badge expande suavemente: 42px → 148px
Transição: 150ms ease-out
Conteúdo: [shield icon] "Atenna Guard"
Novo elemento aparece: Ícone "+" (upload)
  - Posição: lado direito do badge expandido
  - Tamanho: 16px inline SVG
  - Cor: rgba(34, 197, 94, 0.6) (verde suave)
  - Label: "Analisar arquivo"
  
Comportamento:
  • Badge clicável = abre modal (como agora)
  • Ícone "+" clicável = abre fluxo upload FASE 4.1
  
Exemplo visual:
┌─────────────────────────┐
│ [shield] Atenna Guard [+]│
└─────────────────────────┘
```

#### Click no Badge (Atual)

- Abre modal Settings normal (comportamento não muda)
- Se autenticado: Settings completa
- Se não autenticado: Login view
- Upload widget está em Settings → Documentos (quando MULTIMODAL_ENABLED=true)

#### Click no Ícone "+" (Novo)

- Abre fluxo específico de upload (não toca na modal principal)
- Estado visual: Upload widget em overlay mínimo ou sheet deslizável
- Feature flag: Botão invisible se MULTIMODAL_ENABLED=false
- Fallback: Tooltip "Essa funcionalidade ainda está em desenvolvimento" (quando disabled)

---

### Regras Visuais

#### NÃO USAR ❌

- ❌ Emoji em título ("📎", "🔍", etc)
- ❌ Símbolo "+" grosseiro ou bordão (usar SVG minimalista)
- ❌ Badge grande ou sempre expandido
- ❌ Botão flutuante adicional separado
- ❌ Pulsing animation ou "chame atenção"
- ❌ Popup/tooltip agressivo
- ❌ Múltiplas cores (apenas verde #22c55e)

#### USAR ✅

- ✅ SVG inline simples (16px, stroke 2px)
- ✅ Transição suave: `opacity 150ms ease` + `width 150ms ease-out`
- ✅ Hover effect: cor sutil (rgba sem full opacity)
- ✅ Area clicável clara (mínimo 40px × 40px)
- ✅ Label texto simples: "Analisar arquivo"
- ✅ Discreto até hover (ícone 60% opacity quando idle, 100% ao hover)
- ✅ Acompanha motion do badge (sem elemento solto)

#### Implementação CSS

```css
/* Quando MULTIMODAL_ENABLED = true */
.atenna-btn:hover .atenna-btn__upload-icon {
  opacity: 1;
  transform: scale(1) translateX(0);
  transition: opacity 150ms ease, transform 150ms ease;
}

/* Quando MULTIMODAL_ENABLED = false (feature flag) */
.atenna-btn__upload-icon.disabled {
  display: none;  /* ou podia ser opacity: 0.3 com tooltip "Em breve" */
}
```

---

### Acessibilidade

#### Keyboard Navigation

```
Tab 1: Chega ao badge
  → aria-label="Atenna Guard. Abrir configurações"
  → Enter: abre modal
  
Tab 2 (ao hover): Ícone upload
  → aria-label="Analisar arquivo"
  → Enter: abre fluxo upload
  
Tab 3 (em modal): próximo elemento
  
Escape: fecha overlay se upload aberto
```

#### Screen Reader

```html
<button 
  class="atenna-btn" 
  aria-label="Atenna Guard. Abrir configurações. Dica: passe o mouse para analisar arquivo"
  title="Atenna Guard — Clique para configurações"
>
  <svg class="atenna-btn__icon-wrap">...</svg>
  <span class="atenna-btn__label">Atenna Guard</span>
</button>

<!-- Upload icon (dentro do badge ao hover) -->
<button 
  class="atenna-btn__upload-icon" 
  aria-label="Analisar arquivo — Compartilhe documentos com segurança"
  title="Analisar arquivo"
>
  <svg><!-- inline SVG "+" --></svg>
</button>
```

#### Requisitos

- ✅ `aria-label` explicativo em ambos botões
- ✅ `title` attribute para tooltip nativo
- ✅ Focus visible (outline ou ring)
- ✅ Contraste WCAG AA mínimo
- ✅ Min touch target 44×44px (mobile)
- ✅ Sem hover-only disclosure (icon visível via keyboard)

---

### Feature Flag: MULTIMODAL_ENABLED

#### Comportamento Controlado por Flag

```python
# backend/config/flags.py

FLAGS = {
    "MULTIMODAL_ENABLED": {
        "default": False,  # CRÍTICO: false até FASE 4.1 final
        "description": "Show upload icon on badge. Controls FASE 4.1 UI visibility",
        "override": "admin",
    },
}
```

#### Quando MULTIMODAL_ENABLED = FALSE (Padrão)

- Ícone "+" **não renderizado**
- Badge comporta-se como v2.23.0 (sem mudanças)
- Upload widget em Settings não aparece
- Zero impacto visual

#### Quando MULTIMODAL_ENABLED = TRUE (Rollout)

- Ícone "+" aparece ao hover
- Click icon abre fluxo upload
- Upload widget em Settings visível
- DLP scan disponível

#### Frontend Detection

```typescript
// src/content/content.ts ou modal.ts

const MULTIMODAL_ENABLED = await getFlag('MULTIMODAL_ENABLED');

// Ao renderizar badge
if (MULTIMODAL_ENABLED) {
  injectUploadIcon(badge);
}

// Ao renderizar Settings
if (MULTIMODAL_ENABLED) {
  showUploadWidget();
}
```

---

### Event Tracking (Futuro)

Quando upload implementado, rastrear (sem conteúdo do arquivo):

#### Badge Events

```javascript
// upload_entry_hovered
{
  event: "upload_entry_hovered",
  session_id: "...",
  timestamp: "2026-05-08T10:30:00Z",
  // SEM: nome do arquivo, conteúdo, metadata
}

// upload_entry_clicked (no ícone +)
{
  event: "upload_entry_clicked",
  session_id: "...",
  timestamp: "2026-05-08T10:31:00Z",
}

// upload_flow_opened
{
  event: "upload_flow_opened",
  session_id: "...",
  timestamp: "2026-05-08T10:31:02Z",
  entry_point: "badge_icon",  // vs "settings_button"
}
```

#### Regra Crítica

- ❌ Nunca logar: conteúdo do arquivo, nome do arquivo, tamanho, tipo
- ✅ Sempre logar: evento genérico, timestamp, session_id

---

### E2E Tests (Futuros)

Após implementação FASE 4.1, adicionar testes de integração badge-upload:

```typescript
// tests/e2e/badge-upload-entry.spec.ts (novo arquivo)

test.describe('Badge Upload Entry Point', () => {
  
  // A. Badge comportamento idle
  test('✅ Badge não mostra ícone upload quando MULTIMODAL_ENABLED=false', async ({ page }) => {
    // Configurar flag como false
    // Abrir chat
    // Assert: badge normal, sem ícone extra
  });
  
  // B. Badge comportamento com flag enabled
  test('✅ Badge mostra ícone upload ao hover com MULTIMODAL_ENABLED=true', async ({ page }) => {
    // Configurar flag como true
    // Abrir chat
    // Hover badge
    // Assert: ícone "+" visível, aria-label correto
  });
  
  test('✅ Click badge abre Settings modal (atual)', async ({ page }) => {
    // Badge com flag true
    // Click badge
    // Assert: modal Settings abre
  });
  
  test('✅ Click ícone "+" abre fluxo upload (não modal Settings)', async ({ page }) => {
    // Badge com flag true
    // Hover para revelar ícone
    // Click ícone
    // Assert: modal Settings não abre, upload widget aparece
    // Assert: foco em file input ou drag-drop area
  });
  
  // C. Acessibilidade
  test('✅ Keyboard Tab navega para badge e ícone', async ({ page }) => {
    // Badge com flag true
    // Tab até badge
    // Assert: focus ring visível
    // Tab novamente
    // Assert: foco em ícone upload
  });
  
  test('✅ Enter ativa badge, abre Settings', async ({ page }) => {
    // Tab até badge
    // Enter
    // Assert: Settings abre
  });
  
  test('✅ Enter ativa ícone upload, abre fluxo', async ({ page }) => {
    // Tab até badge, Tab novamente (ícone)
    // Enter
    // Assert: upload flow abre
  });
  
  test('✅ Escape fecha upload flow', async ({ page }) => {
    // Hover/click ícone, upload abre
    // Escape
    // Assert: upload flow fecha, foco volta ao badge
  });
  
  // D. Visual
  test('✅ Badge expande suavemente ao hover', async ({ page }) => {
    // Hover badge
    // Assert: animação visível, duração ~150ms
    // Assert: ícone não "pula", alinha-se com label
  });
  
  test('✅ Ícone upload alinhado corretamente', async ({ page }) => {
    // Badge expandido
    // Assert: ícone direito do label
    // Assert: tamanho 16px ✓
    // Assert: cor verde suave
  });
  
  // E. Responsividade
  test('✅ Badge + ícone não causa overflow em viewport 360px', async ({ page }) => {
    // Viewport: 360px × 640px
    // Badge canto inferior direito
    // Hover
    // Assert: badge não sai da tela
    // Assert: ícone visível (não cortado)
  });
  
  // F. Feature Flag
  test('✅ Toggle flag em runtime muda visibilidade', async ({ page, context }) => {
    // Abrir Settings
    // Flag: false → ícone escondido
    // Toggle flag: true (admin endpoint ou localStorage mock)
    // Refresh página
    // Assert: ícone agora visível
  });
});
```

**Total de testes novos: 12**

---

### Critério de Aceitação

A seção "Badge Upload Entry Point" é **CONCLUÍDA** quando:

- [ ] Comportamento idle/hover documentado com exemplos visuais
- [ ] Regras visuais (use/don't use) claras e sem ambiguidade
- [ ] Acessibilidade: keyboard, screen reader, WCAG AA mínimo
- [ ] Feature flag MULTIMODAL_ENABLED especificado (default=false)
- [ ] Evento tracking não logar conteúdo sensível
- [ ] E2E tests planejados (12 testes, referenciados acima)
- [ ] Nenhuma implementação ainda (apenas spec)

---

## 6. Arquitetura Frontend

### Component: `UploadWidget` (`src/ui/upload-widget.ts`)

```typescript
interface UploadWidgetConfig {
  targetElement: HTMLElement;  // onde renderizar
  maxSize: Record<string, number>;  // {"txt": 1MB, "csv": 5MB, ...}
  onReady: (content: string, preview: string) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

interface UploadState {
  phase: 'idle' | 'uploading' | 'validating' | 'scanning' | 'ready' | 'error';
  progress: number;  // 0-100
  file?: File;
  dlpRisk?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  entities?: DetectedEntity[];
  contentPreview?: string;
  contentHash?: string;
  charCount?: number;
}

class UploadWidget {
  config: UploadWidgetConfig;
  state: UploadState = { phase: 'idle', progress: 0 };
  
  constructor(config: UploadWidgetConfig) { ... }
  
  // Render UI
  render(): void { ... }
  
  // Handle file selection (via input or drag-drop)
  handleFileSelect(file: File): void { ... }
  
  // Validate file locally before upload
  validateFile(file: File): { valid: boolean; error?: string } { ... }
  
  // Upload file to backend
  async uploadFile(file: File): Promise<UploadResult> { ... }
  
  // Show protection banner if HIGH risk
  showProtectionBanner(entities: DetectedEntity[]): void { ... }
  
  // User clicks [Proteger dados]
  async handleProtect(): Promise<void> { ... }
  
  // User clicks [Enviar original]
  async handleSendOriginal(): Promise<void> { ... }
  
  // User clicks [Tentar outro]
  handleRetry(): void { ... }
  
  // Cleanup on unmount
  cleanup(): void { ... }
}
```

### Integration in Settings Page

```typescript
// src/ui/modal.ts — in renderSettingsPage()

// Add in body (after privacy section)
const documentsTitle = document.createElement('div');
documentsTitle.className = 'atenna-settings__section-title';
documentsTitle.textContent = '📎 Documentos';
body.appendChild(documentsTitle);

const documentSection = document.createElement('div');
documentSection.className = 'atenna-settings__section';
documentSection.id = 'upload-widget-container';
body.appendChild(documentSection);

// Initialize widget
const uploadWidget = new UploadWidget({
  targetElement: documentSection,
  maxSize: {
    'txt': 1024 * 1024,
    'md': 1024 * 1024,
    'csv': 5 * 1024 * 1024,
    'json': 1024 * 1024,
  },
  onReady: (content, preview) => {
    // Content is ready — trigger chat with document
    void openChatWithDocument(content, preview);
  },
  onError: (error) => {
    showToast(error, 'error');
  },
  onCancel: () => {
    // Cleanup
  },
});
```

### CSS Classes (Add to `src/ui/modal.css`)

```css
/* Upload Widget */
.atenna-upload-widget {
  background: var(--at-card-bg);
  border: 2px dashed var(--at-border);
  border-radius: 10px;
  padding: 24px;
  text-align: center;
  min-height: 120px;
  transition: all 150ms ease;
}

.atenna-upload-widget.drag-active {
  border-color: var(--at-green);
  background: rgba(34, 197, 94, 0.04);
}

.atenna-upload-widget__icon { font-size: 32px; margin-bottom: 8px; }
.atenna-upload-widget__text { font-size: 13px; color: var(--at-text); }
.atenna-upload-widget__hint { font-size: 11px; opacity: 0.5; margin-top: 8px; }

.atenna-upload-widget__input {
  display: none;
}

.atenna-upload-widget__button {
  margin-top: 12px;
  padding: 8px 16px;
  background: var(--at-green);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
}

.atenna-upload-widget__button:hover {
  background: #16a34a;
}

/* Progress */
.atenna-upload-progress {
  margin-top: 12px;
  font-size: 11px;
  color: var(--at-text);
  opacity: 0.7;
}

.atenna-upload-progress-bar {
  width: 100%;
  height: 2px;
  background: var(--at-border);
  border-radius: 1px;
  overflow: hidden;
  margin-top: 4px;
}

.atenna-upload-progress-bar__fill {
  height: 100%;
  background: var(--at-green);
  transition: width 300ms ease;
}

/* Result states */
.atenna-upload-result { margin-top: 12px; }
.atenna-upload-result.success { color: #16a34a; }
.atenna-upload-result.error { color: #ef4444; }
.atenna-upload-result.pending { color: #f59e0b; }
```

---

## 7. Arquitetura Backend

### New Endpoint: `POST /user/upload-document`

```python
# backend/routes/documents.py

from fastapi import APIRouter, UploadFile, HTTPException
from backend.dlp.docExtractor import extract_document_content
from backend.dlp.docDlpEngine import DocumentDLPEngine

router = APIRouter(prefix="/user/upload-document", tags=["documents"])

@router.post("")
async def upload_document(
    file: UploadFile,
    session_id: str = Header(...),
    access_token: str = Header(...),
):
    """
    Upload and scan document.
    
    Returns: { success, dlp_risk_level, entities, preview, ... }
    
    Guarantees:
    - File never persisted
    - Content never persisted
    - Only hash + metadata in DB
    - Memory cleaned after response
    """
    
    # Step 1: Validate
    validation = validate_document_file(file)
    if not validation.valid:
        raise HTTPException(status_code=400, detail=validation.error)
    
    # Step 2: Extract content (memory only)
    try:
        content = await extract_document_content(file.file, validation.file_type)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Falha ao ler arquivo")
    
    # Step 3: DLP scan
    dlp_analysis = await document_dlp_engine.scan(
        content=content,
        doc_type=validation.file_type,
        session_id=session_id,
    )
    
    # Step 4: Log telemetry (no content)
    await telemetry_service.log_document_upload(
        user_id=extract_user_id(access_token),
        file_type=validation.file_type,
        file_size=len(content),
        dlp_risk=dlp_analysis.risk_level,
        entity_count=len(dlp_analysis.entities),
    )
    
    # Step 5: Prepare response
    response = {
        "success": True,
        "dlpRiskLevel": dlp_analysis.risk_level,
        "entityCount": len(dlp_analysis.entities),
        "entityTypes": dlp_analysis.entity_types,
        "contentPreview": mask_preview(content[:500]),
        "contentHash": hash_content(content),
        "charCount": len(content),
    }
    
    # Step 6: Cleanup (CRITICAL)
    del content
    gc.collect()  # Force cleanup
    
    return response


@router.post("/rewrite")
async def rewrite_document(
    content_hash: str,
    action: str = "protect",  # "protect" or "send_original"
    access_token: str = Header(...),
):
    """
    User chose to protect or send original.
    
    If protect:
      - Apply rewrite to content
      - Return sanitized content
    
    If send_original:
      - Return content as-is
      - Log user choice
    """
    
    if action == "protect":
        # Content is already extracted in frontend memory
        # Backend just confirms the choice
        return {
            "success": True,
            "action": "protect",
            "message": "Conteúdo será sanitizado antes de enviar",
        }
    else:
        # send_original
        return {
            "success": True,
            "action": "send_original",
            "message": "Conteúdo será enviado como-is",
        }
```

### Helper Modules

#### 1. Document Extractor (`backend/dlp/docExtractor.py`)

```python
class DocumentExtractor:
    """Safe content extraction — no persistence."""
    
    @staticmethod
    async def extract_txt(file_bytes: bytes) -> str:
        return file_bytes.decode('utf-8', errors='replace').strip()
    
    @staticmethod
    async def extract_md(file_bytes: bytes) -> str:
        return file_bytes.decode('utf-8', errors='replace').strip()
    
    @staticmethod
    async def extract_csv(file_bytes: bytes) -> str:
        """Extract CSV as plain text (preserving structure)."""
        text = file_bytes.decode('utf-8', errors='replace')
        return text.strip()
    
    @staticmethod
    async def extract_json(file_bytes: bytes) -> str:
        """Extract JSON (pretty-print for readability)."""
        import json
        try:
            data = json.loads(file_bytes)
            return json.dumps(data, indent=2, ensure_ascii=False)
        except:
            return file_bytes.decode('utf-8', errors='replace')

async def extract_document_content(file_obj, file_type: str) -> str:
    """
    Extract content from file.
    Never persists file or content.
    """
    file_bytes = await file_obj.read()
    
    if file_type == 'txt':
        return await DocumentExtractor.extract_txt(file_bytes)
    elif file_type == 'md':
        return await DocumentExtractor.extract_md(file_bytes)
    elif file_type == 'csv':
        return await DocumentExtractor.extract_csv(file_bytes)
    elif file_type == 'json':
        return await DocumentExtractor.extract_json(file_bytes)
    else:
        raise ValueError(f"Unsupported type: {file_type}")
```

#### 2. File Validator (`backend/dlp/docValidator.py`)

```python
import mimetypes
import magic

class DocumentValidator:
    """Validate file type, size, encoding."""
    
    ALLOWED_TYPES = {
        'txt': {'mime': 'text/plain', 'max_size': 1024 * 1024},
        'md': {'mime': 'text/markdown', 'max_size': 1024 * 1024},
        'csv': {'mime': 'text/csv', 'max_size': 5 * 1024 * 1024},
        'json': {'mime': 'application/json', 'max_size': 1024 * 1024},
    }
    
    MAX_CHARS = 100_000
    
    @staticmethod
    def validate_file(file: UploadFile) -> dict:
        """
        Validate:
        1. Extension
        2. MIME type (declared)
        3. Magic bytes (actual)
        4. File size
        5. Encoding
        """
        
        # Check extension
        ext = file.filename.split('.')[-1].lower()
        if ext not in DocumentValidator.ALLOWED_TYPES:
            return {
                "valid": False,
                "error": f"Tipo não suportado. Suportamos: {', '.join(ALLOWED_TYPES.keys())}",
            }
        
        config = DocumentValidator.ALLOWED_TYPES[ext]
        
        # Check size
        if file.size > config['max_size']:
            return {
                "valid": False,
                "error": f"Arquivo muito grande ({file.size / 1MB}MB > {config['max_size'] / 1MB}MB)",
            }
        
        # Check MIME
        if file.content_type != config['mime']:
            # May be false positive (e.g., .txt labeled as application/octet-stream)
            # Check magic bytes instead
            pass
        
        # Check encoding (after extraction)
        # Will validate in extractor
        
        return {
            "valid": True,
            "file_type": ext,
            "content_type": file.content_type,
            "size": file.size,
        }
```

#### 3. Document DLP Engine (`backend/dlp/docDlpEngine.py`)

```python
class DocumentDLPEngine:
    """DLP for documents — same rules as text, for now."""
    
    def __init__(self, text_engine):
        self.engine = text_engine
    
    async def scan(
        self,
        content: str,
        doc_type: str,
        session_id: str,
    ) -> DLPAnalysis:
        """
        Scan document content.
        Uses existing DLP engine (no special rules yet).
        
        PHASE 4.1: Simple text scan
        PHASE 4.2+: Document-specific rules
        """
        
        # Use existing engine
        analysis = await self.engine.analyze(content, session_id)
        
        # Future: Add document-specific rules
        # if doc_type == 'csv':
        #   → stricter numeric patterns (account numbers)
        # if doc_type == 'json':
        #   → look for API keys in values
        
        return analysis
```

---

## 8. Storage Strategy

### Decision: No Persistence (FASE 4.1)

**File Storage:**
- ❌ Never written to disk
- ❌ Never persisted to DB
- ❌ Only hash + metadata in audit log

**Content Storage:**
- ❌ Never extracted to DB
- ❌ Kept in memory during processing only
- ✅ Hash stored for dedup (future)

**Metadata Storage:**
```sql
-- audit_log only (RLS protected)
INSERT INTO document_audit_log (
  user_id,
  file_type,
  file_size_bytes,
  dlp_risk_level,
  entity_count,
  entity_types,
  user_action,  -- "sent_original" or "protected"
  created_at
) VALUES (...)
```

**Memory Management:**
```python
# After response sent:
del content
del file_bytes
gc.collect()  # Force immediate cleanup
```

### Future (FASE 4.2+)

When adding history/storage:
```sql
CREATE TABLE document_uploads (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  content_hash TEXT NOT NULL,  -- SHA256 of extracted content
  file_name TEXT,
  file_type VARCHAR(10),
  dlp_risk_level VARCHAR(10),
  user_action VARCHAR(20),
  created_at TIMESTAMP,
  expires_at TIMESTAMP,
  
  -- NEVER store:
  -- raw_content
  -- extracted_content
  -- sensitive_values
);
```

---

## 9. Segurança

### Critical Security Properties

#### 1. No Raw File to Provider
```
Frontend:
  1. User uploads file
  2. Backend extracts content
  3. Frontend receives content (not file)
  4. If HIGH risk → rewrite
  5. Send content (or rewritten) to provider
  
Never: Raw .txt file sent to provider
```

#### 2. No Sensitive Entity Values Logged
```
✅ Log this:
  { entity_type: "CPF", count: 1 }
  
❌ Never log:
  { entity_type: "CPF", value: "123.456.789-10" }
```

#### 3. No Raw Content in Logs
```
✅ Log this:
  { file_type: "txt", char_count: 2500 }
  
❌ Never log:
  { content: "Full text here..." }
```

#### 4. Memory Cleanup
```python
# After processing, MUST cleanup:
del content
del file_bytes
gc.collect()  # Force
```

#### 5. Hash-Based Dedup (Future)
```python
# Store hash for dedup
content_hash = hashlib.sha256(content.encode()).hexdigest()

# Check if content already processed
existing = db.query("SELECT * FROM document_hashes WHERE hash = ?", content_hash)
if existing:
  # Reuse previous analysis (privacy win)
```

### Threat Model

| Threat | Mitigation |
|---|---|
| File contains malware | Magic bytes + size validation (not prevention) |
| File is huge (DoS) | Size limit per type (1-5 MB) |
| Encoding attack | Normalize text, strip control chars |
| Injection in CSV | DLP scan (same as text) |
| API key in JSON | DLP scans values (future: stricter rules) |
| Zip bomb | Not supported (FASE 5+) |

---

## 10. Limites Operacionais

### Hard Limits

| Limit | Value | Justification |
|---|---|---|
| Max TXT size | 1 MB | Processing speed |
| Max MD size | 1 MB | (same) |
| Max CSV size | 5 MB | CSV often larger |
| Max JSON size | 1 MB | Config files typically small |
| Max chars total | 100.000 | DLP processing time |
| Max concurrent uploads | 1 | Simplicity (no queue) |
| DLP timeout | 10 seconds | UI responsiveness |
| Encoding support | UTF-8, ASCII, Latin-1 | Most files |
| Upload timeout | 30 seconds | Network issues |

### Soft Limits (Warnings)

| Limit | Value | Message |
|---|---|---|
| File > 500 KB | 500 KB | "Large file — may take a moment" |
| Chars > 50k | 50k | "Processing may take a few seconds" |
| Entities > 10 | 10 | "Many data points detected — review carefully" |

### Graceful Degradation

| Scenario | Behavior |
|---|---|
| DLP timeout | Return UNKNOWN risk (not HIGH) — user decides |
| Encoding error | Replace invalid chars with "?" + continue |
| Extraction error | Show error "Arquivo corrompido" |
| Memory error | Cleanup + error "Tente um arquivo menor" |

---

## 11. DLP Documental

### Current Approach (FASE 4.1)

**Use existing DLP engine:**
- Same 15 categories (CPF, Email, Phone, API_KEY, Token, etc.)
- Same NLP + regex detection
- Same risk scoring
- No special document rules (yet)

```python
# Same call as text:
analysis = await dlp_engine.analyze(content, session_id)
```

### Future Approach (FASE 4.2+)

**Document-specific rules:**
```python
if doc_type == 'csv':
  # CSV-specific: detect numeric columns (account #, phone #)
  # Stricter patterns

if doc_type == 'json':
  # JSON-specific: look for API_KEY in values
  # Detect "secret", "password", "key" fields

if doc_type == 'pdf_scanned':
  # OCR-specific: higher confidence threshold
  # Detect document patterns (RG, CPF in structured format)
```

---

## 12. Rewrite Documental

### Rewrite Strategy

**Goal:** Make content safe for provider while preserving meaning

```
BEFORE (HIGH risk):
"Meu CPF é 123.456.789-10, email é test@example.com e celular 11987654321"

AFTER (rewrite):
"Meu CPF é [CPF_XXXXX], email é [EMAIL_XXXXX] e celular [PHONE_XXXXX]"
```

### Implementation

```python
# frontend/src/dlp/docRewriter.ts

function rewriteDocumentContent(content: string, entities: DetectedEntity[]): string {
  let result = content;
  
  for (const entity of entities) {
    // Replace each entity with masked placeholder
    const placeholder = `[${entity.type}_XXXXX]`;
    result = result.split(entity.value).join(placeholder);
  }
  
  return result;
}
```

### Limitations

- ❌ Only replaces exact entity values (not partial patterns)
- ❌ Doesn't preserve formatting in CSV (all becomes plain text)
- ❌ Doesn't support complex replacements (e.g., "redact CPF but keep structure")
- ✅ Good enough for MVP

### Future (FASE 4.3+)

- Smart rewriting (preserve structure)
- Whitebox/blackbox LLM-based rewriting
- Format-aware rewriting (CSV → CSV with masked values)

---

## 13. Telemetry

### What to Log

```python
# Telemetry event (document_upload_events table)
{
  "user_id": "uuid",
  "session_id": "session_uuid",
  "event_type": "document_upload",
  "file_type": "txt",
  "file_size_bytes": 2500,
  "dlp_risk_level": "HIGH",
  "entity_count": 3,
  "entity_types": ["CPF", "EMAIL"],  # just types
  "user_action": "protected",  # "protected" or "sent_original"
  "processing_time_ms": 1250,
  "created_at": "2026-05-08T10:30:00Z",
}
```

### What NOT to Log

```python
# ❌ NEVER log:
{
  "content": "Full text here...",  # breach
  "entity_values": ["123.456.789-10", "test@example.com"],  # breach
  "preview": "...",  # risk
  "payload_sent_to_provider": "...",  # breach
}
```

### Audit Trail

```sql
CREATE TABLE document_audit_log (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  event_type VARCHAR(50),
  file_type VARCHAR(10),
  dlp_risk_level VARCHAR(10),
  entity_count INT,
  entity_types TEXT[],
  user_action VARCHAR(20),
  status VARCHAR(20),  -- "success", "failed", "timeout"
  error_message TEXT,  -- if failed (sanitized)
  created_at TIMESTAMP,
);

-- User can query own audit trail
ALTER TABLE document_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own audit" ON document_audit_log
  FOR SELECT USING (auth.uid() = user_id);
```

---

## 14. Retenção

### Current (FASE 4.1)

**No persistence = No retention needed**
- File deleted immediately
- Content deleted immediately
- Only hash + metadata in audit log
- Audit log: keep 90 days

### Future (FASE 4.2+)

When adding history:
```sql
CREATE TABLE document_uploads (
  ...
  created_at TIMESTAMP,
  expires_at TIMESTAMP,  -- 30 days from creation
);

-- Daily purge job
SELECT cron.schedule(
  'purge-old-uploads',
  '0 3 * * *',  -- 3 AM UTC daily
  'DELETE FROM document_uploads WHERE expires_at < NOW();'
);
```

---

## 15. Cleanup

### Immediate Cleanup (per upload)

```python
# After response sent to client:

1. Delete extracted content from memory
   del content
   
2. Delete file bytes
   del file_bytes
   
3. Force garbage collection
   import gc
   gc.collect()
   
4. Clear backend state
   # No global variables
   # No lingering references
```

### Session Cleanup (on logout)

```typescript
// frontend: after user logs out

1. Delete upload widget state
   uploadWidget.cleanup()
   
2. Clear browser cache
   // Automatic (session storage, not persistent)
   
3. No files left
   // Never persisted in first place
```

### Scheduled Cleanup (if history added later)

```sql
-- Purge old documents daily
CREATE OR REPLACE FUNCTION purge_expired_documents()
RETURNS void AS $$
BEGIN
  DELETE FROM document_uploads
  WHERE expires_at < NOW()
  AND archived = false;
  
  -- Log purge event
  INSERT INTO purge_audit (table_name, deleted_count, purged_at)
  VALUES ('document_uploads', ROW_COUNT(), NOW());
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
  'purge-documents',
  '0 3 * * *',
  'SELECT purge_expired_documents();'
);
```

---

## 16. UX States

### 6 Visual States

#### 1. IDLE (Initial)
```
┌──────────────────────────────────┐
│ 📎 Compartilhe documentos com IA │
│ TXT · MD · CSV · JSON · Máx 1 MB │
│                                  │
│   [ Selecionar arquivo ]         │
│   ou arraste aqui                │
└──────────────────────────────────┘
```

#### 2. UPLOADING
```
┌──────────────────────────────────┐
│ 📎 Enviando documento.txt...      │
│ ▓▓▓▓▓▓░░░░░░░ 60%                 │
│ (300 KB de 500 KB)               │
└──────────────────────────────────┘
```

#### 3. ANALYZING
```
┌──────────────────────────────────┐
│ 🔍 Analisando dados sensíveis...  │
│                                  │
│ Verificando conteúdo             │
└──────────────────────────────────┘
```

#### 4. READY_NO_RISK
```
┌──────────────────────────────────┐
│ ✓ Pronto para enviar             │
│                                  │
│ documento.txt (500 KB)           │
│ 15.234 caracteres                │
│ Nenhum dado sensível detectado.  │
│                                  │
│   [ Enviar para IA ]             │
│   [ Compartilhar outra ]         │
└──────────────────────────────────┘
```

#### 5. READY_HIGH_RISK
```
┌──────────────────────────────────┐
│ ⚠️ Dados sensíveis detectados    │
│                                  │
│ 3 possíveis dados sensíveis:     │
│ CPF · Email · Telefone           │
│                                  │
│   [ Proteger dados ]             │
│   [ Enviar original ]            │
└──────────────────────────────────┘
```

#### 6. ERROR
```
┌──────────────────────────────────┐
│ ❌ Erro ao processar arquivo     │
│                                  │
│ Tipo não suportado.              │
│ Suportamos: TXT, MD, CSV, JSON   │
│                                  │
│   [ Tentar outro ]               │
└──────────────────────────────────┘
```

---

## 17. Error Handling

### Error Types & Messages

| Error | HTTP | Message | Action |
|---|---|---|---|
| Invalid extension | 400 | "Tipo não suportado. Suportamos: TXT, MD, CSV, JSON" | Retry |
| File too large | 413 | "Arquivo muito grande (10 MB > 5 MB para CSV)" | Retry |
| Encoding error | 400 | "Arquivo corrompido ou encoding não suportado" | Retry |
| Timeout | 504 | "Análise demorou muito. Tente um arquivo menor." | Retry |
| DLP unavailable | 500 | "Erro ao processar. Tente novamente em momentos." | Retry |
| Out of memory | 500 | "Servidor sobrecarregado. Tente em alguns momentos." | Retry |

### Error States (UX)

All errors show:
1. Error icon (❌)
2. Clear message (not technical)
3. Actionable button ([Tentar outro])
4. Optional: advice ("Tente um arquivo menor")

---

## 18. Timeout Handling

### Timeout Rules

| Operation | Timeout | Fallback |
|---|---|---|
| Upload (multipart) | 30s | "Conexão lenta — tente novamente" |
| Extract content | 5s | "Arquivo grande demais" |
| DLP scan | 10s | Return UNKNOWN risk (not HIGH) |
| Full pipeline | 20s | "Análise demorou — tente arquivo menor" |

### Timeout Behavior

```python
import asyncio

async def process_with_timeout(coro, timeout_seconds):
    try:
        return await asyncio.wait_for(coro, timeout=timeout_seconds)
    except asyncio.TimeoutError:
        # Log timeout (no content)
        await telemetry.log_timeout(
            session_id=session_id,
            operation="dlp_scan",
            timeout_ms=timeout_seconds * 1000,
        )
        # Return safe default
        return {
            "success": False,
            "dlp_risk_level": "UNKNOWN",  # not HIGH!
            "error": "Análise demorou muito",
        }
```

---

## 19. Chunking Strategy

### FASE 4.1: No Chunking

**Rationale:**
- Max 100k chars
- Fits in memory
- DLP engine processes in one go
- No need for chunking yet

**Simple approach:**
```python
content = await extract_document_content(file)
analysis = await dlp_engine.analyze(content, session_id)
```

### Future (FASE 4.2+): Sliding Window

If content > 100k chars (larger files in future phases):
```python
CHUNK_SIZE = 50_000
OVERLAP = 5_000

def chunk_text(text: str, chunk_size: int, overlap: int):
    chunks = []
    for i in range(0, len(text), chunk_size - overlap):
        chunk = text[i:i + chunk_size]
        chunks.append(chunk)
    return chunks

# Scan each chunk, aggregate results
```

---

## 20. Provider Boundary

### What Can Go to Provider

✅ **Allowed:**
- Extracted text (original)
- Rewritten text (if user clicked [Proteger dados])
- File metadata (filename, type, size)
- User context (system prompt, etc.)

❌ **Never:**
- Raw file bytes
- Entity values (CPF, email addresses)
- Sensitive metadata (EXIF, timestamps)
- Internal hashes or IDs
- DLP analysis details

### Payload Sanitization

```python
# Before sending to provider:

if user_action == "protected":
    # Send rewritten content
    provider_payload = {
        "content": rewritten_content,
        "file_type": "document",
        "note": "User's document (sensitive data masked)"
    }
else:
    # Send original content
    provider_payload = {
        "content": original_content,
        "file_type": "document",
        "note": "User's document (original content)"
    }

# Never include:
# - entity_values
# - dlp_analysis
# - content_hash
# - user_id (only auth header)
```

---

## 21. E2E Tests Obrigatórios

### Test Categories

#### A. File Validation (5 tests)
- ✅ Valid TXT uploads successfully
- ✅ Valid CSV (larger) uploads successfully
- ✅ Invalid extension rejected
- ✅ Oversized file rejected
- ✅ Encoding error handled gracefully

#### B. DLP Scanning (4 tests)
- ✅ CPF detected in TXT
- ✅ Email detected in CSV
- ✅ API key detected in JSON
- ✅ No false positives on clean document

#### C. Risk Flow (4 tests)
- ✅ No risk → [Enviar para IA] button appears
- ✅ High risk → [Proteger dados] [Enviar original] appear
- ✅ User clicks [Proteger dados] → rewrite applied
- ✅ User clicks [Enviar original] → content unchanged

#### D. Error Handling (4 tests)
- ✅ Oversized file shows correct error message
- ✅ Invalid encoding shows "corrompido"
- ✅ Timeout shows "demorou muito"
- ✅ User can retry after error

#### E. Security (3 tests)
- ✅ Raw file never reaches provider
- ✅ Entity values not in response
- ✅ Content not in logs

#### F. Cleanup (2 tests)
- ✅ Memory cleaned after upload
- ✅ No residual content in browser cache

**Total: 22 tests**

### Test Structure

```typescript
// tests/e2e/fase-4.1-document-upload.spec.ts

test.describe('FASE 4.1: Document Upload', () => {
  
  // Setup
  beforeEach(async ({ page }) => {
    // Open Settings → Documents section
    // Initialize upload widget
  });
  
  // A. Validation
  test('✅ Valid TXT uploads successfully', async ({ page }) => {
    // 1. Create valid TXT (< 1 MB)
    // 2. Upload
    // 3. Assert success state
  });
  
  test('✅ Oversized file rejected', async ({ page }) => {
    // 1. Create TXT > 1 MB
    // 2. Upload
    // 3. Assert error message "muito grande"
  });
  
  // B. DLP Scanning
  test('✅ CPF detected in TXT', async ({ page }) => {
    // 1. Create TXT with CPF: "CPF: 123.456.789-10"
    // 2. Upload
    // 3. Assert DLP response has entity_type: "CPF"
  });
  
  // C. Risk Flow
  test('✅ High risk shows protection banner', async ({ page }) => {
    // 1. Upload TXT with CPF
    // 2. Assert [Proteger dados] button visible
    // 3. Assert [Enviar original] button visible
  });
  
  test('✅ User clicks [Proteger dados]', async ({ page }) => {
    // 1. Upload TXT with CPF
    // 2. Click [Proteger dados]
    // 3. Assert CPF replaced with [CPF_XXXXX]
  });
  
  // D. Error Handling
  test('✅ Timeout shows graceful error', async ({ page }) => {
    // 1. Mock slow backend (> 10s)
    // 2. Upload
    // 3. Assert "demorou muito" message
    // 4. Assert [Tentar outro] button
  });
  
  // E. Security
  test('✅ Raw file never reaches provider', async ({ page, context }) => {
    // 1. Intercept network requests
    // 2. Upload TXT with sensitive data
    // 3. Assert NO raw TXT in request body
  });
  
  test('✅ Entity values not in response', async ({ page, context }) => {
    // 1. Intercept response from /user/upload-document
    // 2. Upload TXT with CPF
    // 3. Assert response has entity_types: ["CPF"]
    // 4. Assert response NOT has entity_value: "123.456.789-10"
  });
  
  // F. Cleanup
  test('✅ Memory cleaned after upload', async ({ page }) => {
    // 1. Upload file
    // 2. Check backend memory (mock)
    // 3. Assert content deleted
  });
});
```

---

## 22. Rollback Plan

### If Something Goes Wrong

#### Scenario 1: Parser Crashes on Edge Case

```
Symptom: Specific file type causes backend crash
Response: Immediately reject that file type
  
Code:
MULTIMODAL_ENABLED = false
DOCUMENT_DLP_ENABLED = false
→ Upload widget disabled
→ Users see: "Documentos temporariamente indisponíveis"

Remediation:
1. Identify problematic file pattern
2. Add validation rule
3. Add test case
4. Re-enable

Timeline: < 1 hour
```

#### Scenario 2: Memory Leak

```
Symptom: Server memory grows with each upload
Response: Disable uploads, force cleanup
  
Code:
# Force cleanup on every upload
gc.collect()

# Add monitoring
monitor_memory_usage()

# If > 80%: disable uploads temporarily
```

#### Scenario 3: False Positive Spam

```
Symptom: All documents flagged as HIGH risk
Response: Revert DLP rules to text-only
  
Code:
USE_DOCUMENT_DLP_RULES = false
→ Fallback to text DLP engine (no document rules)

Recovery:
1. Adjust sensitivity thresholds
2. Add document-specific rules
3. Re-enable
```

#### Scenario 4: Provider Integration Broken

```
Symptom: User uploads, protects, but content not sent to provider
Response: User can choose [Enviar original] fallback
  
If rewritten content fails:
→ Offer to send original (user informed)
→ Log the failure
→ Alert ops team

Timeline: Transparent to user
```

### Rollback Commands (Admin Only)

```bash
# Disable upload widget
curl -X POST https://api.atenna.ai/admin/config \
  -d '{"MULTIMODAL_ENABLED": false}'

# Force cleanup on all sessions
curl -X POST https://api.atenna.ai/admin/cleanup \
  -d '{"scope": "all"}'

# Reset feature flags
curl -X POST https://api.atenna.ai/admin/reset-flags
```

---

## 23. Feature Flags

### Flags for FASE 4.1

```python
# backend/config/flags.py

FLAGS = {
    "MULTIMODAL_ENABLED": {
        "default": False,
        "description": "Enable document upload widget",
        "override": "admin",
    },
    
    "DOCUMENT_DLP_ENABLED": {
        "default": True,  # always on (when multimodal enabled)
        "description": "Run DLP scan on documents",
    },
    
    "STRICT_DOCUMENT_MODE": {
        "default": True,
        "description": "High risk = block by default (only show [Proteger])",
    },
    
    "DOCUMENT_UPLOAD_LIMIT_MB": {
        "default": 5,  # for CSV
        "description": "Max upload size in MB",
    },
    
    "DOCUMENT_TIMEOUT_SECONDS": {
        "default": 10,
        "description": "Max DLP scan time",
    },
    
    "DOCUMENT_MAX_CHARS": {
        "default": 100_000,
        "description": "Max characters after extraction",
    },
}

# Usage
if config.get_flag("MULTIMODAL_ENABLED"):
    # Show upload widget
    pass
```

### Rollout Strategy

**Phase 1: Internal Testing**
```
MULTIMODAL_ENABLED = False
DOCUMENT_DLP_ENABLED = True
(Devs only)
```

**Phase 2: Beta Users (5%)**
```
MULTIMODAL_ENABLED = (random() < 0.05)
STRICT_DOCUMENT_MODE = True
```

**Phase 3: General Release (100%)**
```
MULTIMODAL_ENABLED = True
STRICT_DOCUMENT_MODE = False  (optional)
```

---

## 24. Critérios de Aprovação

### Go/No-Go Checklist

FASE 4.1 pode ser aprovada para implementação apenas quando:

- [ ] Spec completa e revisada
- [ ] Limites definidos e justificados (sizes, timeouts)
- [ ] Lifecycle definido (IDLE → CLEANUP)
- [ ] Storage strategy decidida (no persistence)
- [ ] Cleanup garantido (memory + cache)
- [ ] Provider boundary claro (what goes, what doesn't)
- [ ] DLP scan integração especificada
- [ ] Telemetry spec (no content logged)
- [ ] 22+ E2E tests planejados
- [ ] Rollback plan definido
- [ ] Feature flags especificadas
- [ ] Error handling para cada cenário
- [ ] Timeout handling para cada operação
- [ ] Security review passed
- [ ] No blocking issues

### Approval Sign-Off

**Required From:**
- [ ] Tech Lead (architecture)
- [ ] Security (data protection)
- [ ] Product (UX/scope)
- [ ] DevOps (infrastructure)

**Approval Means:**
- ✅ Spec is implementable
- ✅ No architectural blockers
- ✅ Security properties guaranteed
- ✅ Ready for FASE 4.1 implementation

---

## Próximas Ações

1. **Revisão da SPEC**
   - Tech team reviews all 24 sections
   - Security review of threat model
   - Product review of UX states

2. **Aprovação**
   - Sign-off from leads
   - Mark as "APPROVED"

3. **Implementação**
   - Start FASE 4.1 development
   - Follow spec exactly
   - Add tests as specified

4. **Lançamento**
   - QA tests against 22 E2E tests
   - Gradual rollout (feature flag)
   - Monitor errors + memory

---

**Status:** 📋 Spec Completa — Aguardando Aprovação

**Próximo Passo:** User aprova ou solicita revisões

