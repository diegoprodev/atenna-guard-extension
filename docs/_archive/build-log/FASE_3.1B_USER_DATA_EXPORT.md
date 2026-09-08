# FASE 3.1B: Governed User Data Export

**Status:** ✅ IMPLEMENTAÇÃO COMPLETA  
**Data:** 2026-05-08  
**Objetivo:** Implementar exportação segura de dados do titular conforme LGPD Art. 18 (Direito ao Acesso)

---

## Princípios Fundamentais

### O Que NÃO É

❌ **Dump técnico completo** — "exportar tudo sem filtro"  
❌ **Vetor de vazamento** — "dados sensíveis em claro"  
❌ **Download imediato** — "sem confirmação, sem controle"

### O Que É

✅ **Relatório seguro de tratamento** — categorias, contagens, datas  
✅ **Redução de sensibilidade** — nomes nunca, valores nunca  
✅ **Governança de lifecycle** — requisição → confirmação → geração → expiração  
✅ **Auditoria completa** — quem fez, quando, quantos downloads

---

## Lifecycle Completo

```
┌──────────────┐
│   REQUESTED  │  User solicita export
└──────┬───────┘
       │ User clica link no email
       ▼
┌──────────────────────────┐
│     CONFIRMED            │  Token validado, ready para processar
└──────┬───────────────────┘
       │ Sistema gera PDF
       ▼
┌──────────────────────────┐
│     PROCESSING           │  Gerando relatório
└──────┬───────────────────┘
       │ PDF pronto
       ▼
┌──────────────────────────┐
│     READY                │  Aguardando download (48h)
└──────┬───────────────────┘
       │ User faz download (max 3x)
       │ OU 48h expiram
       ▼
┌──────────────────────────┐
│     EXPIRED              │  Janela de download encerrou
└──────┬───────────────────┘
       │ Job automático
       ▼
┌──────────────────────────┐
│     PURGED               │  Arquivo removido
└──────────────────────────┘

ESTRUTURA:
- REQUESTED: token de confirmação válido 24h
- CONFIRMED: PDF sendo gerado
- READY: PDF pronto para download (máx 3 downloads em 48h)
- EXPIRED: Janela de download expirou
- PURGED: Arquivo deletado, requisição arquivada
- FAILED: Erro durante geração
```

---

## Arquitetura

### Tabelas (SQL)

#### `user_export_requests`

```sql
id (uuid pk)
user_id (uuid FK → auth.users)
status (enum)
  - requested: inicial
  - confirmed: email confirmado
  - processing: gerando PDF
  - ready: PDF pronto
  - expired: janela expirou
  - purged: arquivo deletado
  - failed: erro

download_token (text unique) — seguro, aleatório
download_count (int) — quantos downloads feitos
max_downloads (int) — máximo permitido (3)
requested_at, confirmed_at, processing_started_at, completed_at, expires_at, purged_at
```

### Python Backend

#### `export_manager.py`

```python
class ExportManager:
    
    # Constants
    DEFAULT_EXPIRY_HOURS = 48
    TOKEN_VALIDITY_HOURS = 24
    MAX_DOWNLOADS = 3
    MIN_REQUEST_INTERVAL_HOURS = 24
    MAX_EXPORT_REQUESTS = 1
    
    # Public methods
    request_export(user_id, email) -> dict
    confirm_export(token, expires_in_hours) -> dict
    generate_pdf(user_id, email, account_created_at, plan) -> bytes
    mark_export_ready(download_token) -> dict
    get_download_stream(download_token) -> dict
    get_export_status(user_id) -> dict
    purge_expired_exports() -> dict
    get_export_summary() -> dict
```

#### `routes/export.py`

```python
POST   /user/export/request
       → Solicitar export (rate-limit: 1/24h)
       
POST   /user/export/confirm?token=...&expires_in_hours=48
       → Confirmar via link do email
       
GET    /user/export/status
       → Ver status de export pendente
       
GET    /user/export/download?token=...
       → Download do PDF (valida token + max_downloads)
       
POST   /user/export/purge
       → Admin: purge exports expirados
       
GET    /user/export/summary
       → Admin: sumário de compliance
```

---

## Fluxo Completo do User

### Passo 1: Solicitar Export

```
User va para Settings > Dados Pessoais > "Exportar meus dados"
     ↓
POST /user/export/request
     ↓
Response: "Email de confirmação enviado para diego@atenna.ai"
     ↓
Email chega em 30 segundos com link:
https://atenna.ai/confirm-export?token=abc123...xyz
(Link válido por 24 horas)
```

### Passo 2: Confirmar pelo Email

```
User clica link no email
     ↓
Browser: GET /confirm-export?token=abc123...xyz
     ↓
Backend executa confirm_export(token)
     ↓
Status muda para CONFIRMED
PDF começa a ser gerado
     ↓
Email enviado: "Seu relatório está pronto para download"
"Clique aqui para fazer download (válido por 48 horas)"
```

### Passo 3: Período de Download (48h)

```
User clica link de download
     ↓
GET /user/export/download?token=...
     ↓
Backend valida:
  - Token existe e é válido
  - Não expirou (< 48h)
  - Download count < 3
     ↓
PDF é retornado via stream
Download count é incrementado
     ↓
User consegue fazer até 3 downloads do mesmo PDF
```

### Passo 4: Expiração Automática

```
Após 48h:
  - PDF não pode mais ser baixado
  - Status muda para EXPIRED
     ↓
Job automático (cron):
  - Purga arquivos expirados
  - Status muda para PURGED
  - Requisição é arquivada
```

---

## PDF — Estrutura Segura

### O que PODE conter

✅ Email do titular (não user_id bruto)  
✅ Data de criação da conta, plano (Free/Pro)  
✅ Contagem total de eventos DLP por categoria  
✅ Tipos de entidades detectadas (categorias): "CPF", "EMAIL", "API_KEY"  
✅ Datas de eventos (não payloads)  
✅ Resumo de proteções aplicadas (quantos reescritos, quantos alertas)  
✅ Políticas de retenção por nível de risco  
✅ Histórico de solicitações LGPD (deleção, export anteriores)  
✅ Seus direitos LGPD (Art. 17, 18, 20) + contato de suporte

### O que NÃO pode conter

❌ Valores completos de CPF (050.423.674-11) — apenas categoria "CPF"  
❌ Valores de API key, JWT, credentials  
❌ Conteúdo integral de prompts  
❌ Payloads brutos de requests  
❌ Stack traces, logs internos, erros técnicos  
❌ Detalhes de infraestrutura (IPs, URLs internas, versões)  
❌ Senhas, secrets, tokens

### Layout (4 páginas máx)

**Página 1 — Header**
- Logo Atenna
- Título: "Relatório de Dados Pessoais"
- Data de geração
- Número do relatório (RPT-XXXX)
- LGPD Art. 18 — Direito ao Acesso

**Página 2 — Dados da Conta**
- Email registrado
- Data de criação
- Plano (Free/Pro)
- Status da conta (Ativa/Deletada)

**Página 3 — Sumário de Proteção**
- Categorias de dados detectadas (CPF, Email, Telefone, API_KEY, JWT...)
- Contagem de eventos por categoria
- Ações de proteção (X reescritas, Y alertas)
- Período coberto

**Página 4 — Governança e Direitos**
- Políticas de retenção vigentes
- Histórico de solicitações LGPD
- Seus direitos (Art. 17, 18, 20)
- Contato para dúvidas

---

## Garantias de Segurança

### 1. Sem Download Imediato

```
✓ Email de confirmação obrigatório
✓ Token válido por 24 horas (janela para confirmar)
✓ PDF expira em 48 horas (janela para download)
✓ Total mínimo: 0-72 horas de acesso
```

### 2. Rate Limiting

```
✓ 1 export ativo por usuário por vez
✓ Mínimo 24h entre exports (limite spam)
✓ Máximo 3 downloads por export (limite de compartilhamento)
✓ Token único e aleatório (não reutilizável)
```

### 3. Zero Dados Sensíveis em Claro

```
✓ CPF nunca em valor (apenas categoria)
✓ API key nunca em valor
✓ JWT nunca em valor
✓ Payloads originais nunca no PDF
✓ Nomes nunca em valor (apenas categoria)
```

### 4. Auditoria Completa

```
✓ Timestamps de cada ação
✓ Quantos downloads feitos
✓ Quando expira
✓ Quando foi purgo
✓ Sem PII no audit log
```

---

## Testes Implementados

### Unit Tests (30+ testes)

✅ Export request lifecycle  
✅ Email confirmation with tokens  
✅ Token expiration (24h)  
✅ PDF generation without sensitive leakage  
✅ Download security (token validation, max downloads)  
✅ Rate limiting (1/24h)  
✅ Purge of expired exports  
✅ Fallback mode (Supabase unavailable)  
✅ Error handling & security properties  
✅ Compliance features  

**Status:** 30+/30+ PASSING ✅

### E2E Tests (12 testes)

✅ Export lifecycle documentation  
✅ Request initiation  
✅ Status retrieval  
✅ Token expiration validation  
✅ PDF generation  
✅ Download with max limit  
✅ Rate limit enforcement  
✅ PDF without sensitive data  
✅ PDF with correct categories  
✅ Purge expired exports  
✅ Unauthorized access blocked  
✅ Security headers present  

**Status:** 12/12 READY ✅

---

## Endpoints REST

### `POST /user/export/request`

```json
Response (200):
{
  "success": true,
  "message": "Email de confirmação enviado para diego@atenna.ai",
  "note": "Clique no link no email para confirmar o export",
  "expires_in": "24 horas"
}
```

### `POST /user/export/confirm?token=...&expires_in_hours=48`

```json
Response (200):
{
  "success": true,
  "processing_status": "confirmed",
  "message": "Export agendado para processamento",
  "expires_in_hours": 48,
  "note": "Seu relatório será preparado em breve..."
}
```

### `GET /user/export/status`

```json
Response (200):
{
  "has_pending_request": true,
  "status": "ready",
  "expires_at": "2026-05-10T14:22:00Z",
  "download_count": 1,
  "max_downloads": 3,
  "note": "Seu relatório está pronto para download"
}
```

### `GET /user/export/download?token=...`

```
Response (200): PDF binary stream
Content-Type: application/pdf
Content-Disposition: attachment; filename=relatorio_dados_XXXXXXXX.pdf
```

### `POST /user/export/purge`

```json
Response (200):
{
  "success": true,
  "purged_count": 5,
  "duration_ms": 234,
  "message": "Purged 5 expired exports"
}
```

### `GET /user/export/summary`

```json
Response (200):
{
  "total_exports": 42,
  "exports_completed": 38,
  "exports_expired": 3,
  "exports_purged": 1,
  "message": "Summary of user data export operations..."
}
```

---

## Email Flow

### Email 1: Solicitação de Export

```
Assunto: Confirme sua solicitação de acesso aos dados - Atenna Guard

Olá Diego,

Você solicitou um relatório de seus dados pessoais conforme LGPD Art. 18.

⚠️ Clique aqui para CONFIRMAR:
https://atenna.ai/confirm-export?token=...

Este link é válido por 24 HORAS.

Se NÃO solicitou acesso aos dados, ignore este email.

LGPD Art. 18: Você está exercendo direito ao acesso.
```

### Email 2: Relatório Pronto

```
Assunto: Seu relatório de dados está pronto - Atenna Guard

Olá Diego,

Seu relatório de dados foi gerado com sucesso.

📥 Clique aqui para FAZER DOWNLOAD:
https://atenna.ai/download-export?token=...

O link é válido por 48 HORAS (máx 3 downloads).

Este relatório contém:
✅ Categorias de dados tratadas
✅ Resumo de proteção DLP
✅ Histórico de eventos
✅ Seus direitos LGPD

Se tiver dúvidas: suporte@atenna.ai
```

---

## Compliance & LGPD

### Art. 18: Direito ao Acesso

✅ **Implementado completamente:**
- User consegue solicitar acesso aos dados
- Confirma via email (segurança)
- Recebe relatório de tratamento
- Sem dados sensíveis expostos
- Auditoria preservada

### Características LGPD

- Confirmação por email (não 1-click)
- Período de acesso limitado (48h)
- Limite de downloads (máx 3)
- Rate limit de requisições (1/24h)
- Relatório minimalista (categorias, não valores)
- Zero exposição de infraestrutura

---

## Checklist Aprovação

✅ Export lifecycle implementado  
✅ Email confirmation funcional (24h token)  
✅ PDF geração segura (sem PII)  
✅ Download com validação de token  
✅ Rate limiting (1/24h)  
✅ Expiração automática (48h)  
✅ Purge automático  
✅ Audit trails  
✅ Telemetry segura  
✅ 30+ unit tests passando  
✅ 12 E2E tests prontos  
✅ Documentação completa  
✅ CHANGELOG atualizado  
✅ Commit + sign-off  

---

## Próximas Fases

**FASE 3.1C (1 semana):**
- ✅ Compliance dashboard
- ✅ Audit reports
- ✅ Métricas LGPD

**FASE 3.2 (Futuro):**
- ✅ Data portability
- ✅ Legal holds
- ✅ Retention exceptions

---

**FASE 3.1B PRONTA PARA PRODUÇÃO**

Governança de dados: ✅ Implementada  
Compliance LGPD: ✅ Art. 18 completo  
Segurança: ✅ Soft export + rate limit  
Testing: ✅ 30+ unit + 12 E2E  
Documentation: ✅ Completa
