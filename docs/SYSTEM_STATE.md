# CANONICAL SYSTEM STATE — 2026-05-13

**Status:** Authoritative snapshot of actual running system  
**Last Updated:** 2026-05-13 — After FASE Consolidação TASK 1-3  
**Authority:** Derived from runtime inspection, not documentation

---

## Executive Summary

Atenna Guard Extension is a **three-tier Privacy + Data Loss Prevention (DLP) platform**:

1. **Frontend (Chrome Extension)** — Real-time DLP detection, badge UI, settings
2. **Backend (FastAPI)** — Server-side revalidation, Presidio NER, telemetry persistence
3. **VPS (157.90.246.156)** — Production deployment with multi-LLM fallback

### Key Metrics

| Aspect | Value |
|--------|-------|
| Frontend tests | 133 passing (Vitest) |
| E2E tests | 24 passing (Playwright) |
| Backend tests | 50+ passing (pytest) |
| Build size | 75.07 kB (content.js) |
| TypeScript errors | 0 |
| Python syntax errors | 0 |
| DLP modules | 18 active |
| NLP models | pt_core_news_sm + en_core_web_sm |

---

## ARCHITECTURE

### Data Flow (Request → Response)

```
┌─ FRONTEND (Extension) ──────────────────┐
│                                         │
│  1. User types in textarea              │
│  2. Local DLP scan (Presidio)           │
│  3. Risk badge updated                  │
│  4. POST /generate-prompts with meta    │
│                                         │
└──────────── HTTPS ──────────────────────┘
                  ↓
┌─ BACKEND (FastAPI) ─────────────────────┐
│                                         │
│  5. Verify JWT (Supabase)               │
│  6. Convert Pydantic DlpRequest to dict │
│  7. Call engine.revalidate()            │
│  8. Detect client-server mismatch       │
│  9. Apply enforce_strict (if enabled)   │
│ 10. Rewrite PII: "CPF X" → "CPF [CPF]" │
│ 11. Call Gemini API (with fallbacks)    │
│ 12. Return 3 prompt variations          │
│ 13. Persist telemetry to Supabase       │
│                                         │
└─────────────────────────────────────────┘
                  ↓
┌─ VPS DEPLOYMENT ────────────────────────┐
│ IP: 157.90.246.156                      │
│ Container: Docker + FastAPI + Gunicorn  │
│ LLM Stack: Gemini → OpenAI → Template   │
└─────────────────────────────────────────┘
```

### Component Boundaries

| Component | Technology | Language | Purpose |
|-----------|-----------|----------|---------|
| **Extension** | Chrome Extension API, Manifest V3 | TypeScript | Real-time detection, UI |
| **Backend** | FastAPI + Uvicorn | Python 3.12 | API orchestration, revalidation |
| **DLP Engine** | Presidio + spaCy NER | Python | Entity recognition, scoring |
| **Telemetry** | Supabase PostgeSQL | SQL | Event persistence |
| **Auth** | Supabase JWT | PostgreSQL | User management |
| **LLM** | Gemini + OpenAI | REST APIs | Prompt generation |

---

## BACKEND MODULES (DLP Layer)

### Active Modules (18)

| Module | Purpose | Used By |
|--------|---------|---------|
| `engine.py` | Shared DLP analysis, revalidation, mismatch detection | main.py |
| `pipeline.py` | /dlp/scan orchestration, timeout handling | dlp router |
| `enforcement.py` | Strict Mode: rewrite HIGH-risk PII | main.py |
| `analyzer.py` | Presidio custom recognizers (CPF, CNPJ, etc) | pipeline.py |
| `advisory.py` | Build ScanResponse with user-friendly messages | pipeline.py |
| `scoring.py` | Risk scoring from Presidio results | engine.py, pipeline.py |
| `entities.py` | Pydantic models (ScanRequest, ScanResponse) | /dlp/scan route |
| `lgpd_validator.py` | 15 LGPD categories detection | optional |
| `policy.py` | Policy evaluation, acknowledgment logic | upload.py |
| `scanner.py` | Custom pattern scanning | policy.py |
| `classification.py` | Risk → Classification mapping | scanner.py, policy.py |
| `governance.py` | Audit policy, acknowledgment requirements | audit_policy.py |
| `audit_policy.py` | Build audit events, correlation IDs | test_dlp_phase_4_2a.py |
| `deletion_manager.py` | Account deletion lifecycle (LGPD Art. 17) | routes/deletion.py |
| `export_manager.py` | User data export (LGPD Art. 18) | routes/export.py |
| `retention_manager.py` | Event retention, purging, metrics | routes/retention.py |
| `telemetry.py` | Structured event logging | throughout |
| `telemetry_persistence.py` | In-memory fallback for telemetry | supabase_telemetry.py |
| `supabase_telemetry.py` | Supabase persistence + fallback | telemetry imports |
| `exception_sanitizer.py` | PII-safe error logging middleware | main.py |
| `types.py` | Type definitions, constants | throughout |

### Removed Modules (Dead Code — TASK 3)

- ~~`analytics.py`~~ — Never imported, get_user_metrics() not called
- ~~`benchmark_nlp.py`~~ — Standalone benchmark, never executed

---

## FEATURE FLAGS

### Environment Variables (Active)

| Flag | Current Value | Purpose |
|------|---------------|---------|
| `STRICT_DLP_MODE` | `false` (default) | Rewrite HIGH-risk before provider |
| `SUPABASE_URL` | Set on VPS | Backend auth + telemetry |
| `SUPABASE_SERVICE_ROLE_KEY` | Set on VPS | Telemetry persistence |
| `GEMINI_API_KEY` | Set on VPS | Primary LLM |
| `OPENAI_API_KEY` | Set on VPS | Fallback LLM |

### Disabled Features (Not Yet Implemented)

- ❌ `DOCUMENT_UPLOAD_ENABLED` — not used
- ❌ `MULTIMODAL_ENABLED` — not used
- ❌ `OCR_ENABLED` — not implemented
- ❌ `VISION_API_ENABLED` — not implemented

---

## ENDPOINTS

### Frontend → Backend

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/health` | GET | Health check | No |
| `/generate-prompts` | POST | Generate 3 variations | JWT |
| `/dlp/scan` | POST | Backend DLP analysis | JWT |
| `/dlp/health` | GET | DLP engine status | No |
| `/user/deletion/initiate` | POST | Start account deletion | JWT |
| `/user/deletion/confirm` | POST | Confirm via email | JWT |
| `/user/deletion/cancel` | POST | Cancel pending deletion | JWT |
| `/user/export/request` | POST | Request data export | JWT |
| `/user/export/download` | GET | Download export archive | JWT + token |
| `/retention/purge` | POST | Trigger retention purge | JWT |
| `/retention/metrics` | GET | View retention stats | JWT |
| `/document/upload` | POST | Upload file (PDF/DOCX) | JWT |
| `/document/metrics` | GET | Observability metrics | Internal only |

---

## DLP PIPELINE (Request → Prompt)

### Step 1: Frontend Scan

```
User input → Local Presidio scan → DLP metadata object
{
  dlp_risk_level: "HIGH" | "MEDIUM" | "LOW" | "NONE",
  dlp_entity_count: 3,
  dlp_entity_types: ["BR_CPF", "EMAIL"],
  dlp_was_rewritten: false,
  dlp_user_override: false,
  dlp_session_id: "uuid"
}
```

### Step 2: Server Revalidation

```
Backend receives DLP metadata from client
↓
engine.revalidate() — runs Presidio again server-side
↓
Compare: client risk vs server risk
↓
mismatch.has_mismatch = true if divergence
```

### Step 3: Strict Mode Enforcement

```
IF STRICT_DLP_MODE=false:
  - Log "dlp_strict_would_apply=true"
  - Send original input to Gemini
  
IF STRICT_DLP_MODE=true AND server_risk=HIGH:
  - Rewrite: "CPF 123.456.789-10" → "CPF [CPF]"
  - Send rewritten input to Gemini
  - Log "dlp_strict_applied=true"
```

### Step 4: LLM Cascade

```
Gemini API Call
  ↓ (timeout/503/429/error)
Retry with exponential backoff (1s, 2s)
  ↓ (still failing)
OpenAI gpt-4o-mini Call  
  ↓ (fails)
Template-based fallback (always works)
```

### Step 5: Telemetry Persistence

```
TelemetryEvent object created:
- event_type: "dlp_strict_evaluated"
- risk_level: "HIGH"
- entity_types: ["CPF"]
- session_id: "uuid"
- user_id: from JWT

Persisted to Supabase dlp_events table
Fallback: in-memory if Supabase unavailable
```

---

## AUTHENTICATION

### JWT Flow

```
Extension → Supabase Auth
  ↓
User logs in / signs up
  ↓
Supabase returns JWT (valid 1 hour)
  ↓
Extension stores JWT in chrome.storage.local
  ↓
Every request: Authorization: Bearer <JWT>
  ↓
Backend: require_auth() verifies signature
```

### User Plans

| Plan | Limit | Free Feature | Pro Feature |
|------|-------|--------------|-------------|
| **Free** | 10/day | DLP detection only | Export, Deletion, Retention |
| **Pro** | Unlimited | All features | Advanced audit logs |

---

## BROWSER EXTENSION

### Chrome Storage

```
chrome.storage.local
├── jwt_token (from Supabase auth)
├── user_id (from JWT claims)
├── usage_count (daily counter)
├── reset_date (when counter resets)
├── plan_type ("free" or "pro")
└── dlp_session_id (current session UUID)
```

### Content Script Execution

```
@document_start
  ↓
Load DOM observer
Monitor textarea inputs
Detect user input
  ↓
Send to DLP engine
Get risk badge color
Update UI
  ↓
On "Refine" click:
POST /generate-prompts
Display 3 variations
```

---

## TESTING

### Frontend (Vitest)

- **133 tests** covering:
  - DLP detection accuracy (CPF, EMAIL, API_KEY, etc)
  - UI state management (badge color, modal tabs)
  - Auth flow (login, session restore)
  - Settings page (plan view, export/deletion UI)

### E2E (Playwright)

- **24 tests** covering:
  - Real DLP pipeline (client → server)
  - Strict mode enforcement (rewrite validation)
  - Export/Deletion workflows
  - Multi-tab isolation

### Backend (pytest)

- **50+ tests** covering:
  - Presidio analyzer customization
  - Risk scoring logic
  - Timeout handling (3s max)
  - Supabase persistence
  - JWT validation

---

## VPS DEPLOYMENT

### Infrastructure

```
VPS: 157.90.246.156 (Hetzner)
├── Docker containers:
│   ├── atenna-backend (FastAPI + Gunicorn)
│   ├── postgres (Supabase, replicated)
│   └── nginx (reverse proxy, SSL)
│
├── Python 3.12 + spacy models:
│   ├── pt_core_news_sm (Portuguese NER)
│   ├── en_core_web_sm (English NER)
│
├── Environment vars (set at runtime):
│   ├── STRICT_DLP_MODE (false by default)
│   ├── GEMINI_API_KEY
│   ├── OPENAI_API_KEY
│   └── SUPABASE_SERVICE_ROLE_KEY
│
└── Logs:
    ├── stdout (JSON structured logging)
    ├── docker logs (container lifecycle)
    └── Supabase dlp_events table (persistence)
```

### Monitoring

```
/health endpoint
  ↓ Returns {"status": "ok"}

/document/metrics endpoint (internal)
  ↓ Returns observability metrics:
    - total_parses
    - concurrent_peak
    - orphan_buffer_warnings
    - parse_duration_ms (p95, p99)
    - memory_delta_mb (p95)
```

---

## KNOWN LIMITATIONS

### Current (By Design)

1. **No OCR** — Document images not processed
2. **No Vision API** — Can't analyze images
3. **No Multimodal** — Text-only input
4. **No Real-time Sync** — Extension polls for updates
5. **Free plan limits** — 10 requests/day enforced client-side only

### Tech Debt (Low Priority)

1. **Client-side limits are not server-validated** — User could bypass 10/day via API
2. **STRICT_DLP_MODE not exposed in UI** — Only backend env var
3. **Analytics aggregates** — get_safe_aggregates() method exists but not exposed via API
4. **Benchmark script** — benchmark_nlp.py removed (was never used)

---

## DEPLOYMENT CHECKLIST (VPS)

### Before Rolling Out

- [ ] Run `scripts/profile_vps_document.py` (20 rounds, 3 concurrent)
  - Verify: p95 < 8s, p99 < 10s
  - Verify: 0 orphan buffers, 0 server errors
- [ ] Verify spacy models load: `docker exec atenna-backend python -c "import spacy; spacy.load('pt_core_news_sm')"`
- [ ] Check Supabase connectivity: `curl -X GET https://.../dlp_events?limit=1`
- [ ] Monitor `/document/metrics` for baseline
- [ ] Run E2E suite against production: `npx playwright test --grep @production`

### Rollout (Gradual)

- Day 1: 10% of users (feature flag)
- Day 2: 25% of users
- Day 3: 50% of users
- Day 4: 100% (full rollout)

---

## NEXT TASKS (From FASE Consolidação)

- **TASK 5:** Validate end-to-end flows with real API calls
- **TASK 6:** Update ROADMAP/CHANGELOG to match reality
- **TASK 7:** Generate final consolidated audit report

---

## References

- [VPS Access Guide](VPS_ACCESS_GUIDE.md)
- [Multi-LLM Deployment Report](DEPLOYMENT_2026_05_08.md)
- [TASK 3: Strict Mode Infrastructure](TASK3_STRICT_MODE_STATUS.md)
