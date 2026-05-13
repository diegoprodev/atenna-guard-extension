# FASE 4.2A — DLP Alignment: Reaproveitamento da Atenna Plataforma na Atenna Safe Prompt

**Versão:** 1.0  
**Data:** 2026-05-13  
**Status:** 📋 Spec Oficial — Aprovado para Implementação  
**Autor:** Diego Rodrigues (devdiegopro@gmail.com)  
**Repositório Alvo:** `c:/projetos/atenna-guard-extension`  
**Repositório Fonte (somente leitura):** Atenna Plataforma (`bff/app/dlp/`, `bff/app/decision_engine/`, etc.)

---

## MISSÃO

Usar a arquitetura DLP validada em produção da Atenna Plataforma como referência para elevar o nível técnico do backend da Atenna Safe Prompt — sem criar dependência direta entre os repositórios, sem submodules, sem package compartilhado por enquanto.

**O objetivo é:** copiar e adaptar os padrões maduros da plataforma para a realidade da extensão, criando um núcleo DLP backend robusto e auditável que substitua a dependência atual do detector TypeScript client-side.

---

## REGRAS ABSOLUTAS DESTA FASE

```
NÃO criar dependência direta entre repositórios.
NÃO criar submodule ou git subtree agora.
NÃO mexer no repositório da Atenna Plataforma.
NÃO implementar PDF/DOCX nesta fase.
NÃO implementar OCR.
NÃO implementar imagens.
NÃO implementar dashboard.
NÃO implementar Super Admin.
```

**Primeiro:** consolidar o núcleo DLP adaptado dentro da Atenna Safe.  
**Depois:** FASE 4.2B (PDF/DOCX textual).

---

## 1. CONTEXTO — ESTADO ATUAL DA ATENNA SAFE

### O que existe hoje

| Componente | Estado | Problema |
|---|---|---|
| `src/dlp/detector.ts` | ✅ Funcional (client-side) | Único scanner real — backend frágil |
| `backend/dlp/engine.py` | ⚠️ Parcial | Wraps Presidio — pesado, latência alta |
| `backend/dlp/enforcement.py` | ✅ Funcional | Strict mode operacional |
| `backend/dlp/telemetry.py` | ✅ Funcional | Eventos locais, sem hash chain |
| `backend/dlp/analyzer.py` | ⚠️ Usa `en_core_web_sm` | PT-BR fraco |
| Hash chain | ❌ Ausente | Sem trilha forense |
| Classification levels | ❌ Ausente | Apenas RiskLevel simples |
| Governance matrix | ❌ Ausente | Hardcoded em advisory.ts |
| Outbound security | ❌ Ausente | URLs não validadas |
| Audit policy | ❌ Ausente | Record_prompt não controlado |

### O que a Atenna Plataforma tem (fonte de referência)

Pipeline DLP em 3 estágios validado em produção:

```
Estágio 1 — Pré-Upload:       MIME + tamanho + path traversal → HTTP 403/409
Estágio 2 — Pós-Extração:     DLP scan por seção → classification_level → persistência
Estágio 3 — Pré-LLM:          Masking + governance check → provider boundary
```

Componentes maduros disponíveis para adaptação:

| Arquivo (Plataforma) | Maturidade | Linhas | Testes |
|---|---|---|---|
| `bff/app/dlp/scanner.py` | ⭐⭐⭐⭐⭐ | 488 | 120+ |
| `bff/app/decision_engine/dlp_policy.py` | ⭐⭐⭐⭐⭐ | 315 | 120+ |
| `bff/app/decision_engine/classification_resolver.py` | ⭐⭐⭐⭐⭐ | 133 | — |
| `bff/app/decision_engine/audit_policy.py` | ⭐⭐⭐⭐⭐ | 121 | — |
| `bff/app/audit/hash_chain.py` | ⭐⭐⭐⭐⭐ | 63 | — |
| `bff/app/decision_engine/governance_policy.py` | ⭐⭐⭐⭐⭐ | 150+ | — |
| `bff/app/security/outbound.py` | ⭐⭐⭐⭐⭐ | 52 | — |

---

## 2. GAPS A CORRIGIR NESTA FASE

| Área | Atenna Plataforma | Atenna Safe Atual | Decisão |
|---|---|---|---|
| **DLP Core** | Scanner + Policy robusto (15 patterns, validação aritmética) | Detector TypeScript client-side + Presidio parcial | Criar `scanner.py` + `policy.py` backend inspirados na plataforma |
| **Classification** | 5 níveis LGPD: public/internal/restricted/confidential/secret | 4 RiskLevels simples (NONE/LOW/MEDIUM/HIGH/CRITICAL) | Implementar `classification.py` com `ClassificationLevel` |
| **Audit Policy** | `record_prompt=False` enforçado, retenção por nível | Telemetria local sem controle de retenção rigoroso | Criar `audit_policy.py` com config canônica |
| **Hash Chain** | SHA-256 encadeado, append-only, forensic-grade | Ausente | Criar `backend/audit/hash_chain.py` |
| **Governance** | `GovernanceConstraints` matrix declarativa por nível | Hardcoded em advisory.ts | Criar `governance.py` com matriz completa |
| **Outbound Security** | Allowlist explícita + `assert_safe_llm_url()` | URLs não validadas nos services | Criar `backend/security/outbound.py` |
| **Placeholders** | `[REDACTED_TOKEN]` e `[NOME]` | `[redacted_***]` genérico | Padronizar para lista canônica única |

---

## 3. ARQUIVOS A CRIAR

```
backend/
├── dlp/
│   ├── scanner.py          ← NOVO (adaptado de bff/app/dlp/scanner.py)
│   ├── policy.py           ← NOVO (adaptado de bff/app/decision_engine/dlp_policy.py)
│   ├── classification.py   ← NOVO (adaptado de classification_resolver.py)
│   ├── governance.py       ← NOVO (adaptado de governance_policy.py)
│   ├── audit_policy.py     ← NOVO (adaptado de audit_policy.py)
│   └── types.py            ← NOVO (contratos canônicos)
├── audit/
│   ├── __init__.py         ← NOVO
│   └── hash_chain.py       ← NOVO (adaptado de bff/app/audit/hash_chain.py)
└── security/
    ├── __init__.py         ← NOVO
    └── outbound.py         ← NOVO (adaptado de bff/app/security/outbound.py)
```

---

## 4. CONTRATOS CANÔNICOS (`backend/dlp/types.py`)

### 4.1 EntityType

```python
class EntityType(str, Enum):
    CPF                   = "CPF"
    CNPJ                  = "CNPJ"
    RG                    = "RG"
    PIS_PASEP             = "PIS_PASEP"
    TITULO_ELEITOR        = "TITULO_ELEITOR"
    PHONE                 = "PHONE"
    EMAIL                 = "EMAIL"
    PROCESS_NUMBER        = "PROCESS_NUMBER"
    VEHICLE_PLATE         = "VEHICLE_PLATE"
    ADDRESS               = "ADDRESS"
    CREDIT_CARD           = "CREDIT_CARD"
    API_KEY               = "API_KEY"
    JWT                   = "JWT"
    TOKEN                 = "TOKEN"
    SECRET                = "SECRET"
    MEDICAL_DATA          = "MEDICAL_DATA"
    LEGAL_CONTEXT         = "LEGAL_CONTEXT"
    CONFIDENTIAL_DOCUMENT = "CONFIDENTIAL_DOCUMENT"
```

### 4.2 RiskLevel

```python
class RiskLevel(str, Enum):
    NONE     = "NONE"
    LOW      = "LOW"
    MEDIUM   = "MEDIUM"
    HIGH     = "HIGH"
    CRITICAL = "CRITICAL"
    UNKNOWN  = "UNKNOWN"   # timeout ou falha — NÃO tratar como NONE
```

### 4.3 ClassificationLevel

```python
class ClassificationLevel(str, Enum):
    PUBLIC       = "public"
    INTERNAL     = "internal"
    RESTRICTED   = "restricted"
    CONFIDENTIAL = "confidential"
    SECRET       = "secret"

CLASSIFICATION_ORDER = {
    "public": 0, "internal": 1, "restricted": 2,
    "confidential": 3, "secret": 4,
}
```

### 4.4 DlpFinding

```python
@dataclass(frozen=True)
class DlpFinding:
    entity_type:          EntityType
    risk_level:           RiskLevel
    classification_level: ClassificationLevel
    start:                int
    end:                  int
    confidence:           float         # 0.0 – 1.0
    action:               str           # "block" | "mask" | "alert"
    placeholder:          str           # "[CPF]", "[API_KEY]", etc.
    source:               str           # "regex" | "validator" | "heuristic"
```

### 4.5 DlpScanResult

```python
@dataclass(frozen=True)
class DlpScanResult:
    original_hash:              str                   # SHA-256 do texto original
    masked_content:             str                   # Texto com placeholders
    risk_level:                 RiskLevel             # Nível máximo encontrado
    classification_level:       ClassificationLevel   # Nível classificado
    findings:                   list[DlpFinding]
    entity_types:               list[str]             # Lista de tipos detectados
    blocked:                    bool                  # True se CRITICAL bloqueado
    block_reason:               str | None
    requires_acknowledgment:    bool                  # restricted+ exige confirmação
    telemetry_safe_metadata:    dict                  # Sem valores reais, só hashes
```

---

## 5. PLACEHOLDERS CANÔNICOS

Padronizar entre frontend TypeScript e backend Python. **Nenhum placeholder diferente entre os dois.**

| EntityType | Placeholder |
|---|---|
| CPF | `[CPF]` |
| CNPJ | `[CNPJ]` |
| RG | `[RG]` |
| PIS_PASEP | `[PIS_PASEP]` |
| TITULO_ELEITOR | `[TITULO_ELEITOR]` |
| EMAIL | `[EMAIL]` |
| PHONE | `[TELEFONE]` |
| PROCESS_NUMBER | `[PROCESSO_JUDICIAL]` |
| VEHICLE_PLATE | `[PLACA]` |
| ADDRESS | `[ENDERECO]` |
| CREDIT_CARD | `[CARTAO]` |
| API_KEY | `[API_KEY]` |
| JWT / TOKEN | `[TOKEN]` |
| SECRET | `[SEGREDO]` |
| MEDICAL_DATA | `[DADO_MEDICO]` |
| LEGAL_CONTEXT | `[CONTEXTO_JURIDICO]` |
| CONFIDENTIAL_DOCUMENT | `[DOCUMENTO_CONFIDENCIAL]` |

---

## 6. SCANNER (`backend/dlp/scanner.py`)

Adaptado de `bff/app/dlp/scanner.py` (488 linhas, production-ready).

### Entidades obrigatórias com validação

| Tipo | Pattern Base | Risk | Validação Extra |
|---|---|---|---|
| JWT | `eJy[A-Za-z0-9_-]{10,}` | CRITICAL | 3 partes separadas por ponto |
| API_KEY | `sk-[A-Za-z0-9_-]{16,}` + padrões OpenAI/Stripe/Anthropic/AWS/Google | CRITICAL | Prefixo conhecido |
| SECRET | `(?i)(secret\|password\|passwd\|api_secret).*=.*\S+` | CRITICAL | Regex de assignment |
| TOKEN | `(?i)(token\|bearer).*[A-Za-z0-9_-]{20,}` | CRITICAL | Comprimento mínimo |
| CPF | `\d{3}[. ]\d{3}[. ]\d{3}[-]\d{2}` + sem máscara | MEDIUM | Dígito verificador aritmético |
| CNPJ | `\d{2}[. ]\d{3}[. ]\d{3}[/]\d{4}[-]\d{2}` | MEDIUM | Dígito verificador |
| RG | `\d{1,2}[. ]\d{3}[. ]\d{3}[-]\d{1}` | HIGH | Mín. 7 dígitos |
| PIS_PASEP | 11 dígitos contíguos | HIGH | Dígito verificador |
| TITULO_ELEITOR | 12 dígitos | HIGH | Verificar antes de RG (overlap) |
| CREDIT_CARD | 13–19 dígitos agrupados | HIGH | Luhn checksum |
| PROCESS_NUMBER | `\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}` | HIGH | Validação estrutural CNJ |
| PHONE | DDD 11–99 + 4–5 dígitos | LOW | Guard: local deve iniciar 2–5 ou 9 |
| EMAIL | RFC 5322 simplificado | LOW | Validação semântica |
| VEHICLE_PLATE | `[A-Z]{3}-?\d[A-Z0-9]\d{2}` | MEDIUM | Guard: ano 1900–2099 = falso positivo |
| ADDRESS | `(Rua\|Avenida\|Av\.\|R\.).*\d+` | MEDIUM | Guard: análise léxica |
| MEDICAL_DATA | Heurística contextual | HIGH | CID-10, CRM, termos clínicos |
| LEGAL_CONTEXT | Heurística contextual | MEDIUM | "processo", "vara", "sentença", "réu" |

### Interface pública

```python
def scan(text: str) -> DlpScanResult:
    """
    Escaneia texto, detecta entidades, mascara, retorna resultado imutável.
    Nunca persiste, nunca loga valores originais.
    """
```

### Falsos positivos conhecidos (guards obrigatórios)

- Anos (ex: 1984, 2099) não são placas veiculares
- Sequências numéricas em URLs não são CPF
- Datas `dd/mm/aaaa` não são CNPJ
- Sequências `123456789` sem dígito verificador válido → ignorar
- Strings técnicas base64 < 80 chars → ignorar como TOKEN

---

## 7. POLICY ENGINE (`backend/dlp/policy.py`)

Adaptado de `bff/app/decision_engine/dlp_policy.py`.

### Regras de decisão

```
CRITICAL (API_KEY, JWT, SECRET, TOKEN real, CREDIT_CARD):
  → blocked = True
  → block_reason = "Credencial ou dado financeiro crítico detectado"
  → requer acknowledgment explícito ou strict mode

HIGH (CPF, CNPJ, RG, PROCESS_NUMBER, PIS_PASEP, TITULO_ELEITOR, MEDICAL_DATA):
  → mask automático em strict mode
  → alerta + opção de proteção em modo padrão
  → requires_acknowledgment = True se restricted+

MEDIUM (EMAIL, TELEFONE, ENDEREÇO, PLACA, CNPJ em contexto não-fiscal):
  → alerta
  → proteção opcional
  → não bloqueia

LOW (menção conceitual, exemplo educacional, contexto técnico):
  → não bloqueia
  → não alerta
  → registra em telemetria apenas

UNKNOWN (timeout, falha de engine):
  → NÃO tratar como NONE
  → registrar em telemetria com nível "unknown"
  → não bloquear (para não degradar UX), mas não ignorar
```

### Interface pública

```python
@dataclass(frozen=True)
class PolicyResult:
    masked_text:          str
    findings:             list[DlpFinding]
    max_risk:             RiskLevel
    classification_level: ClassificationLevel
    blocked:              bool
    block_reason:         str | None
    requires_acknowledgment: bool

def evaluate(text: str, strict_mode: bool = False) -> PolicyResult:
    """
    Combina scanner + classification + governance em decisão única.
    strict_mode=True: HIGH+ → mask automático.
    strict_mode=False: HIGH+ → alerta, usuário decide.
    """
```

---

## 8. CLASSIFICATION RESOLVER (`backend/dlp/classification.py`)

Adaptado de `bff/app/decision_engine/classification_resolver.py`.

### Mapeamento canônico

```python
RISK_TO_CLASSIFICATION: dict[RiskLevel, ClassificationLevel] = {
    RiskLevel.NONE:     ClassificationLevel.PUBLIC,
    RiskLevel.LOW:      ClassificationLevel.INTERNAL,
    RiskLevel.MEDIUM:   ClassificationLevel.INTERNAL,
    RiskLevel.HIGH:     ClassificationLevel.RESTRICTED,
    RiskLevel.CRITICAL: ClassificationLevel.CONFIDENTIAL,
    RiskLevel.UNKNOWN:  ClassificationLevel.INTERNAL,  # conservador, com flag operacional
}
```

### Regra de precedência

O nível mais restritivo prevalece sempre. Se múltiplas entidades detectadas, `max(findings, key=CLASSIFICATION_ORDER)`.

### Interface pública

```python
def resolve(risk_level: RiskLevel, findings: list[DlpFinding]) -> ClassificationLevel:
    """Retorna nível mais restritivo com base no risk + findings."""

def show_warning(level: ClassificationLevel) -> bool:
    """True para restricted e acima."""
    return CLASSIFICATION_ORDER[level] >= CLASSIFICATION_ORDER["restricted"]
```

---

## 9. GOVERNANCE MATRIX (`backend/dlp/governance.py`)

Adaptado de `bff/app/decision_engine/governance_policy.py`.

### Matriz canônica

| Nível | Retenção | Model Constraint | Min Audit | DLP Block Threshold | Show Warning |
|---|---|---|---|---|---|
| `public` | 365 dias | none | STANDARD | critical | False |
| `internal` | 365 dias | none | STANDARD | critical | False |
| `restricted` | 90 dias | local_preferred | FULL | high | True |
| `confidential` | 30 dias | local_only | FULL | medium | True |
| `secret` | 7 dias | local_only | FULL | low | True |

### Nota sobre `local_only`

Na Atenna Safe Prompt v1, `local_only` é **placeholder para o futuro**. Hoje significa: "não enviar para provider externo — mostrar erro informativo ao usuário". Não implementar modelo local agora.

### Interface pública

```python
@dataclass(frozen=True)
class GovernanceConstraints:
    retention_days:        int
    max_retention_days:    int
    model_constraint:      str       # "none" | "local_preferred" | "local_only"
    min_audit_level:       str       # "minimal" | "standard" | "full"
    dlp_block_threshold:   str       # "critical" | "high" | "medium" | "low" | "none"
    allowed_providers:     list[str] # [] = todos; ["local"] = apenas local
    require_human_review:  bool
    show_warning:          bool

CLASSIFICATION_GOVERNANCE: dict[str, GovernanceConstraints]

def get_governance(level: ClassificationLevel) -> GovernanceConstraints:
    return CLASSIFICATION_GOVERNANCE[level.value]
```

---

## 10. AUDIT POLICY (`backend/dlp/audit_policy.py`)

Adaptado de `bff/app/decision_engine/audit_policy.py`. **É compliance policy — não modificar a lógica central.**

### Regra absoluta

```
record_prompt        = SEMPRE False   (LGPD Art. 46 — prompt original nunca persiste)
record_masked_prompt = SEMPRE True
record_response      = True apenas se não bloqueado
record_dlp_findings  = controlado por min_audit_level
correlation_id       = OBRIGATÓRIO em todo evento
```

### Retenção por nível

| Nível | Dias | Base Legal |
|---|---|---|
| `public` | 365 | LGPD Art. 16 — retenção padrão |
| `internal` | 365 | Idem |
| `restricted` | 90 | Dados pessoais altamente sensíveis |
| `confidential` | 30 | Dado confidencial máximo |
| `secret` | 7 | Dado secreto + sigilo |

### Interface pública

```python
@dataclass(frozen=True)
class AuditConfig:
    record_prompt:         bool   # sempre False
    record_masked_prompt:  bool   # sempre True
    record_response:       bool
    record_dlp_findings:   bool
    correlation_id:        str    # UUID
    retention_days:        int

def resolve_audit_config(
    classification_level: ClassificationLevel,
    blocked: bool,
    dlp_findings: list[DlpFinding],
    correlation_id: str,
) -> AuditConfig:
    """Retorna config de auditoria imutável para este request."""
```

---

## 11. HASH CHAIN (`backend/audit/hash_chain.py`)

Adaptado de `bff/app/audit/hash_chain.py` (63 linhas). **Reutilizar exatamente — é primitivo criptográfico.**

### Garantias

- Cada evento encadeado ao anterior via `SHA-256`
- Serialização determinística (JSON com keys em ordem fixa)
- Impossível modificar evento histórico sem quebrar cadeia
- `GENESIS_HASH = "0" * 64` para primeiro evento do usuário

### Campos canônicos (imutáveis)

```python
_CANONICAL_FIELDS = [
    "user_id", "correlation_id", "event_name",
    "classification_level", "masked_prompt_hash",
    "dlp_findings_count", "model", "retention_days", "created_at"
]
```

### Eventos que entram na hash chain

```
dlp_high_detected
dlp_critical_blocked
document_uploaded
document_sanitized
payload_sent_to_provider
user_export_requested
account_deletion_requested
retention_purge_completed
strict_mode_applied
```

### Interface pública

```python
GENESIS_HASH: str = "0" * 64

def compute_hash(prev_hash: str, event: dict) -> str:
    """
    Retorna sha256(prev_hash + canonical_json(event)).
    Determinístico. Sem dependências externas (só hashlib + json).
    """
```

---

## 12. OUTBOUND SECURITY (`backend/security/outbound.py`)

Adaptado de `bff/app/security/outbound.py`. **PPSI v2.0 §VI-4.6 compliance.**

### Allowlist explícita

```python
ALLOWED_LLM_HOSTS: frozenset[str] = frozenset({
    "generativelanguage.googleapis.com",  # Gemini
    "api.openai.com",                     # OpenAI / gpt-4.1-nano
    "api.anthropic.com",                  # Anthropic (futuro)
    # Adicionar apenas com aprovação explícita
})
```

### Interface pública

```python
def assert_safe_llm_url(url: str) -> None:
    """
    Lança ValueError se url não está na allowlist.
    Deve ser chamada ANTES de qualquer httpx request para provider.
    Nunca aceitar URL dinâmica de usuário.
    """
```

### Uso obrigatório

```python
# Em openai_service.py e gemini_service.py
assert_safe_llm_url(OPENAI_URL)
async with httpx.AsyncClient(timeout=15.0) as client:
    response = await client.post(OPENAI_URL, ...)
```

---

## 13. PIPELINE ALVO DA ATENNA SAFE (pós FASE 4.2A)

```
input text ou arquivo leve (TXT/MD/CSV/JSON)
    ↓
validação local (content.ts — client-side realtime)
    ↓
extração segura (sem persistir bruto)
    ↓
DLP scanner backend (scanner.py — regex + validação aritmética)
    ↓
classification resolver (classification.py — 5 níveis LGPD)
    ↓
policy engine (policy.py — block/mask/alert por nível)
    ↓
rewrite/masking (placeholders canônicos)
    ↓
audit policy (audit_policy.py — record_prompt=False, correlation_id)
    ↓
hash chain (hash_chain.py — evento encadeado)
    ↓
outbound security (outbound.py — assert_safe_llm_url)
    ↓
envio sanitizado para provider
    ↓
telemetria segura (sem valores reais)
    ↓
retention (governance.py — retenção por classification_level)
```

---

## 14. TESTES OBRIGATÓRIOS

### Unit tests (`backend/tests/test_dlp_phase_4_2a.py`)

Obrigatórios — todos devem passar antes do merge:

```
CPF formatado (xxx.xxx.xxx-xx)
CPF sem máscara (xxxxxxxxxxx)
CPF inválido (dígito verificador errado) → não detectar
CNPJ formatado
CNPJ inválido → não detectar
RG (7 dígitos mínimo)
PIS/PASEP (11 dígitos)
Título de eleitor (12 dígitos)
Cartão de crédito — Luhn válido
Cartão de crédito — Luhn inválido → não detectar
Email simples
Email inválido → não detectar
Telefone com DDD válido
Telefone com DDD inválido → não detectar
Processo CNJ (formato correto)
Processo CNJ (formato incorreto) → não detectar
API key sk-xxx (OpenAI)
API key com prefixo genérico
JWT válido (3 partes)
JWT inválido (2 partes) → não detectar
SECRET assignment (password=xxx)
Endereço com Rua/Av + número
Placa veicular padrão (ABC-1234)
Placa veicular Mercosul (ABC1D23)
Ano isolado (2023) → NÃO é placa (falso positivo)
Falso positivo técnico (base64 curto)
Contexto jurídico (heurística)
Contexto médico (heurística)
Classification mapping: NONE → public
Classification mapping: MEDIUM → internal
Classification mapping: HIGH → restricted
Classification mapping: CRITICAL → confidential
Classification mapping: UNKNOWN → internal (com flag)
Governance: restricted → retention 90 dias
Governance: confidential → retention 30 dias
Governance: secret → retention 7 dias
Audit policy: record_prompt sempre False
Audit policy: record_masked_prompt sempre True
Hash chain: determinístico (mesma entrada → mesmo hash)
Hash chain: encadeamento (prev_hash muda o resultado)
Hash chain: gênesis hash "0"*64
Outbound: URL autorizada → sem erro
Outbound: URL não autorizada → ValueError
Outbound: URL dinâmica de usuário → ValueError
Policy: API_KEY → blocked=True
Policy: CPF + strict_mode=True → masked automático
Policy: CPF + strict_mode=False → alerta, não bloqueia
Policy: UNKNOWN → telemetria, não NONE
```

### E2E obrigatório (`tests/e2e/fase-4.2a-dlp-alignment.spec.ts`)

```
Input com CPF → backend retorna masked [CPF]
Input com API_KEY → backend bloqueia (blocked=True)
Input com JWT → backend bloqueia
Input com PROCESS_NUMBER → classification restricted
Input limpo → classification public
Telemetria não contém valores originais
Provider URL validada antes do request
strict_mode=True + CPF → prompt sanitizado chega ao provider
Regressão: fluxo normal sem DLP não é afetado
```

---

## 15. O QUE NÃO REAPROVEITAR

| Componente | Motivo |
|---|---|
| Legacy Edge Functions TypeScript (`supabase/functions/`) | Em depreciação, Python é superior, hash chain ausente |
| Presidio como DLP core | Overhead 200MB+ de modelos, latência 150–200ms vs 10–30ms regex |
| AtlasDlpGuard client (`dlp_guard.py`) | É adapter antigo, não implementação — será removido da plataforma |
| Atlas Worker completo | Pesado, acoplado à infraestrutura da plataforma (MinIO, Qdrant) |
| Qdrant / embeddings / RAG | Fora do escopo da Atenna Safe Prompt |

---

## 16. SEQUÊNCIA DE IMPLEMENTAÇÃO

### FASE 4.2A (esta fase)

```
1. backend/dlp/types.py          — contratos canônicos (EntityType, RiskLevel, ClassificationLevel, DlpFinding, DlpScanResult)
2. backend/dlp/scanner.py        — detector regex + validação aritmética (18 entidades)
3. backend/dlp/classification.py — classification resolver (5 níveis LGPD)
4. backend/dlp/policy.py         — policy engine (block/mask/alert)
5. backend/dlp/governance.py     — governance matrix declarativa
6. backend/dlp/audit_policy.py   — audit config (record_prompt=False enforçado)
7. backend/audit/__init__.py     — módulo novo
8. backend/audit/hash_chain.py   — hash chain SHA-256
9. backend/security/__init__.py  — módulo novo
10. backend/security/outbound.py — allowlist + assert_safe_llm_url()
11. Integrar outbound.py nos services (openai_service.py, gemini_service.py)
12. Padronizar placeholders em detector.ts (frontend) para coincidir com types.py
13. Testes unitários (backend/tests/test_dlp_phase_4_2a.py)
14. Testes E2E (tests/e2e/fase-4.2a-dlp-alignment.spec.ts)
15. CHANGELOG v2.27.0
16. Atualizar DLP_ENTERPRISE_ROADMAP.md
17. Commit + push
```

### FASE 4.2B (próxima — após 4.2A GREEN)

```
backend/document/parsers/pdf_parser.py     — PDF textual (pdfplumber/pypdf)
backend/document/parsers/docx_parser.py   — DOCX textual (python-docx)
Endpoint upload-document atualizado com DLP por seção
Rewrite documental (placeholders em conteúdo extraído)
Provider boundary (arquivo bruto nunca vai ao provider)
Leak-proof tests
```

### FASE 4.2C (após 4.2B GREEN)

```
Validação: provider nunca recebe PDF/DOCX bruto
Validação: texto sanitizado apenas
Telemetria sem conteúdo
Memory cleanup
Timeout + malformed file + oversized file
```

### FASE 4.3 (somente após 4.2C GREEN)

```
OCR (pytesseract + pt_core_news_sm)
Imagens sensíveis (RG, CNH, comprovantes)
EXIF stripping
```

---

## 17. CRITÉRIO DE APROVAÇÃO FASE 4.2A

A FASE 4.2A só é **GREEN** quando:

- [ ] `backend/dlp/types.py` criado com todos os contratos canônicos
- [ ] `backend/dlp/scanner.py` criado — detecta as 18 entidades obrigatórias
- [ ] `backend/dlp/classification.py` criado — 5 níveis + mapeamento
- [ ] `backend/dlp/policy.py` criado — block/mask/alert por nível
- [ ] `backend/dlp/governance.py` criado — matriz completa
- [ ] `backend/dlp/audit_policy.py` criado — `record_prompt=False` enforçado
- [ ] `backend/audit/hash_chain.py` criado — SHA-256 encadeado
- [ ] `backend/security/outbound.py` criado — allowlist + assert
- [ ] Outbound integrado em `openai_service.py` e `gemini_service.py`
- [ ] Placeholders frontend (`detector.ts`) alinhados com `types.py`
- [ ] Todos os testes unitários passando (40+ testes)
- [ ] E2E básico passando (9 cenários)
- [ ] Zero regressão no DLP atual (138 testes existentes passando)
- [ ] CHANGELOG v2.27.0 atualizado
- [ ] `DLP_ENTERPRISE_ROADMAP.md` status matrix atualizada
- [ ] Commit e push feitos

---

## 18. IMPORTANTE — DECISÕES IRREVOGÁVEIS

```
NUNCA persistir prompt bruto.
NUNCA persistir arquivo bruto.
NUNCA persistir valor de entidade.
NUNCA logar CPF, JWT, API_KEY, SECRET em plain text.
NUNCA aceitar URL de provider de fonte externa/usuário.
SEMPRE record_prompt = False.
SEMPRE correlation_id em todo evento de auditoria.
SEMPRE usar placeholders canônicos — sem divergência frontend/backend.
```

---

*Este documento é a fonte de verdade para a FASE 4.2A da Atenna Safe Prompt.*  
*Qualquer mudança de escopo requer aprovação explícita e atualização deste arquivo.*  
*Próxima revisão após aprovação da FASE 4.2A.*
