# Atenna Guard Extension — Roadmap 2026

**Current Status:** v2.35.0 — Super Admin + Upload→Chat Inject deployados  
**Last Updated:** 2026-05-15  
**Next Milestone:** v2.36.0 — Document Upload UI (habilitar feature flag) + Checkout Asaas Pro

---

## RELEASED VERSIONS

### ✅ v2.35.0 — Upload→Chat Inject + BRL Dinâmico (2026-05-15)
- Botões "Copiar" e "Aplicar no chat" após DLP scan de documento
- Taxa USD/BRL ao vivo via frankfurter.app (fallback R$ 5,06)
- BRL formatado com 2 casas decimais em todo o admin panel
- **Status:** ✅ DEPLOYED

---

### ✅ v2.34.0 — FASE 5.0: Super Admin Control Plane (2026-05-15)
- Painel admin completo: Overview (KPIs reais + charts), Usuários (CRUD), DLP, Custos, Sistema, Flags, Erros, Auditoria
- Páginas novas: Custo por Usuário, Planos Pro (free/pro/enterprise + MRR)
- Dados reais: auth.users API, CF Gateway logs, user_dlp_stats, dlp_events
- Política de senha super_admin (12+ chars, maiúscula, especial)
- **Status:** ✅ DEPLOYED

---

### ✅ v2.33.0 — DLP Qualidade e UX (2026-05-14)
- Fix paste detection ChatGPT, labels de prompts corrigidos, counter dinâmico
- **Status:** ✅ DEPLOYED

---

### ✅ v2.32.0 — Correções Críticas de Produção (2026-05-14)
- host_permissions, telemetry.server_revalidated, iframe guard, ícone engrenagem SVG
- **Status:** ✅ DEPLOYED

---

### ✅ v2.31.0 — Cloudflare AI Gateway (2026-05-14)
- OpenAI + Gemini roteados via CF Gateway; custo, cache, logs centralizados
- **Status:** ✅ DEPLOYED

---

### ✅ v2.29.0 — FASE 4.2C (Stress Harness + Observabilidade)
**Released:** 2026-05-13

**Features:**
- Document observability metrics (p50/p95/p99 latencies, memory delta)
- 24/24 adversarial + stress tests passing
- PDF/DOCX parsing with security guards
- VPS profiling script ready

**Status:** ✅ DEPLOYED TO PRODUCTION

---

### ✅ v2.28.0 — FASE 4.2B (Document Pipeline)
**Released:** 2026-05-12

**Features:**
- Secure PDF/DOCX parsing
- File upload endpoint `/document/upload`
- Resource limits enforcement
- MIME validation + magic bytes

**Status:** ✅ DEPLOYED (Feature flag OFF — awaiting FASE 4.2C profiling)

---

### ✅ v2.27.0 — FASE 4.2A (DLP Enterprise Alignment)
**Released:** 2026-05-11

**Features:**
- Governance constraints
- Classification framework
- Audit policy implementation
- LLM outbound validation

**Status:** ✅ DEPLOYED

---

### ✅ v2.26.0 — FASE 3.1B-UI (Privacy & Governance UI)
**Released:** 2026-05-10

**Features:**
- User data export UI (LGPD Art. 18)
- Account deletion UI (LGPD Art. 17)
- Settings page integration
- 12 E2E tests

**Status:** ✅ DEPLOYED

---

### ✅ v2.25.0 — FASE 3.1A (Account Deletion)
**Released:** 2026-05-05

**Features:**
- Account deletion API endpoints
- 7-day grace period
- LGPD compliance logging
- Deletion confirmation via email

**Status:** ✅ DEPLOYED

---

### ✅ v2.24.0 — FASE 3.0 (User Data Export)
**Released:** 2026-05-02

**Features:**
- Data export API endpoints
- PDF generation
- Token-based download access
- Supabase integration

**Status:** ✅ DEPLOYED

---

### ✅ v2.23.0 — FASE 2.4 (Retention Management)
**Released:** 2026-04-28

**Features:**
- Event retention policies
- Automatic purging (90-day TTL)
- Retention metrics API
- Storage calculation

**Status:** ✅ DEPLOYED

---

### ✅ v2.22.0 — FASE 2.3 (Telemetry Persistence)
**Released:** 2026-04-20

**Features:**
- Supabase-backed telemetry
- Structured JSON logging
- In-memory fallback
- Security sanitization

**Status:** ✅ DEPLOYED

---

### ✅ v2.21.0 — FASE 2.2 (Safe Analytics)
**Released:** 2026-04-15

**Features:**
- PII-safe aggregation
- User metrics (no details)
- Dashboard support
- Compliance reporting

**Status:** ✅ DEPLOYED

---

### ✅ v2.20.0 — FASE 2.1 (Anti-Leakage E2E)
**Released:** 2026-04-10

**Features:**
- 22 E2E anti-leakage tests
- HTTP request interception (Playwright)
- Payload validation
- Full compliance audit

**Status:** ✅ DEPLOYED

---

## IN PROGRESS

### 🔄 v2.36.0 — FASE 5 Document Upload UI + Asaas Checkout

**Milestones:**
- ⏳ Habilitar `DOCUMENT_UPLOAD_ENABLED=true` no `.env` da VPS
- ⏳ UI de upload integrada ao fluxo principal (não apenas settings)
- ⏳ Checkout Asaas para planos Pro (mensal/anual)
- ⏳ Webhook Asaas → Supabase user_plans (status sync)

**Expected Completion:** 2026-05-25

---

## PLANNED PHASES

### ⏳ FASE 5: Document Processing (v2.30.0+)
**Estimated Start:** 2026-05-20  
**Duration:** 3-4 weeks  
**Dependencies:** TASK 1-5 complete

**Milestones:**
1. Enable `DOCUMENT_UPLOAD_ENABLED=true` (after profiling approval)
2. User-facing document upload UI
3. Async document processing
4. DLP analysis on extracted text
5. Export with document metadata

**Deliverables:**
- Document upload page in extension
- /document/upload endpoint public
- Background job processor
- Document retention policy
- 15+ E2E tests

---

### ⏳ FASE 6: OCR Support (v2.31.0+)
**Estimated Start:** 2026-06-15  
**Duration:** 4-5 weeks  
**Dependencies:** FASE 5 complete

**Milestones:**
1. Tesseract or Google Vision integration
2. OCR error handling & cleanup
3. Text extraction from images
4. Language detection (PT-BR, EN)
5. DLP analysis on OCR output

**Deliverables:**
- Image upload support
- OCR processing pipeline
- Quality metrics (confidence, errors)
- 10+ E2E tests

---

### ⏳ FASE 7: Multimodal (v2.32.0+)
**Estimated Start:** 2026-07-15  
**Duration:** 5-6 weeks  
**Dependencies:** FASE 5-6 complete

**Milestones:**
1. Vision API integration (OpenAI or Google)
2. Image understanding pipeline
3. Multi-format prompt generation
4. DLP analysis on visual content
5. Unified response format

**Deliverables:**
- Image-aware prompt generation
- Vision model selection (Claude 4 Vision, GPT-4V, Gemini Pro Vision)
- Prompt variants for different modalities
- 20+ E2E tests

---

## DEFERRED / LOW PRIORITY

### ❌ Live Model Switching
**Reason:** Not critical path; can use fallback cascade  
**Considerations:** Would require UI changes, real-time model availability checks

### ❌ Client-Side Feature Flags
**Reason:** Security risk (users could enable disabled features)  
**Approach:** Server-driven config instead

### ❌ Custom DLP Policies (MVP)
**Reason:** LGPD defaults sufficient; can revisit for enterprise  
**Timeline:** Post-v2.32.0

### ❌ Real-Time Collaboration
**Reason:** Not MVP requirement  
**Timeline:** Enterprise feature, 2027+

---

## KNOWN LIMITATIONS (Current)

| Limitation | Workaround | Timeline |
|-----------|-----------|----------|
| Client-side 10/day limit not server-enforced | Server audit trail only | FASE 5 |
| No OCR for images | Document text-only | FASE 6 |
| No vision analysis | Text analysis only | FASE 7 |
| Strict Mode not exposed in UI | Backend env var only | FASE 5 or later |
| No real-time sync | Poll-based (acceptable) | Not planned |
| No custom DLP rules | LGPD defaults only | Enterprise feature |

---

## PERFORMANCE TARGETS

### Latency (p95)
- `/generate-prompts`: < 3s (Gemini) or < 4s (OpenAI)
- `/dlp/scan`: < 500ms
- `/document/upload`: < 5s (for 10MB max)
- `/user/export/request`: < 100ms

### Concurrency
- Document processing: 3 concurrent max
- DLP scanning: No limit (async)
- Users: 50+ concurrent before scaling needed

### Reliability
- Uptime: 99%+ (monitored)
- Error rate: < 1% (5xx)
- Timeout rate: < 1%

---

## SECURITY MILESTONES

| Milestone | Status | Date |
|-----------|--------|------|
| JWT authentication required | ✅ | 2026-04-01 |
| PII-safe logging | ✅ | 2026-04-15 |
| Telemetry persistence secure | ✅ | 2026-04-20 |
| Server-side revalidation | ✅ | 2026-05-01 |
| Anti-leakage E2E tests | ✅ | 2026-04-10 |
| Strict Mode infrastructure | ✅ | 2026-05-07 |
| Canonical audit trail | 🔄 | 2026-05-15 |
| Security hardening review | ⏳ | 2026-05-20 |
| Penetration testing | ⏳ | 2026-06-01 |

---

## COMPLIANCE MILESTONES

| Regulation | Requirement | Status | Date |
|-----------|-----------|--------|------|
| LGPD | User data export (Art. 18) | ✅ | 2026-05-02 |
| LGPD | Account deletion (Art. 17) | ✅ | 2026-05-05 |
| LGPD | Retention policy (Art. 16) | ✅ | 2026-04-28 |
| LGPD | No session recording (Art. 46) | ✅ | 2026-05-11 |
| LGPD | Audit trail (for deletions) | ✅ | 2026-05-05 |
| ISO 27001 | Encryption in transit | ✅ | — |
| ISO 27001 | Access controls (JWT) | ✅ | — |
| ISO 27001 | Audit logging | ✅ | 2026-04-20 |

---

## BUDGET (Estimated)

### Infrastructure (VPS)
- Current: Hetzner 2GB RAM, 1 vCPU (~€5-10/month)
- FASE 5: Scale to 4GB RAM, 2 vCPU (~€15-20/month)
- FASE 7: Potential load balancer + 3 instances (~€50-70/month)

### API Costs (Monthly)
- Gemini: ~$10-20 (included in Google Cloud free tier)
- OpenAI: ~$20-50 (fallback usage)
- Supabase: ~$50 (database + auth)
- **Total:** ~$80-120/month

### Development (Estimated)
- FASE 5: 160 hours (~$3,200 at $20/hr)
- FASE 6: 200 hours (~$4,000)
- FASE 7: 240 hours (~$4,800)

---

## ROLLOUT STRATEGY

### Phase 1: Beta (10% Users)
- New features behind feature flags
- Enhanced monitoring
- Manual testing by power users
- Duration: 1 week

### Phase 2: Staged (25-50% Users)
- Gradual flag enablement
- Metric monitoring (latency, errors)
- User feedback collection
- Duration: 2 weeks

### Phase 3: Full Rollout (100% Users)
- All users enabled
- Standard monitoring
- Documentation complete
- Duration: 1 week

---

## MONITORING & OBSERVABILITY

### Current Metrics
- Endpoint health (`/health`)
- DLP latency (backend logs)
- Error rates (JSON logs)
- Memory usage (container stats)

### Future Additions (FASE 5+)
- Prometheus metrics export
- Grafana dashboard
- Alert rules (5xx > 1%, timeout > 5%)
- User funnel tracking
- Feature flag rollout tracking

---

## DECISION TREE: Next Phase Selection

```
Is TASK 1-7 (Consolidação) complete?
├─ NO → Continue TASK 5-7
│       (Current: TASK 5 planning, TASK 6 in progress)
│
└─ YES → Security hardening review?
         ├─ NOT PASSED → Fix issues, re-audit
         │
         └─ PASSED → Feature FASE 5 ready?
                     ├─ YES → Start FASE 5 (Document Upload)
                     │
                     └─ NO → Update roadmap, plan FASE 5
```

---

## STAKEHOLDER UPDATES

### For Investors
- 6 phases completed, 1 in consolidation
- 24 E2E tests passing, 0 production incidents
- LGPD compliance ready
- User base growing (estimate: 5-10 beta users)

### For Users
- Core DLP features stable
- Privacy controls available
- Data export/deletion workflows working
- Roadmap: Document upload in 4 weeks

### For Internal Team
- Consolidation ensures spec ↔ code alignment
- Dead code removed, architecture clean
- Canonical docs created (SYSTEM_STATE, FEATURE_FLAGS, VPS_RUNTIME)
- Ready for FASE 5 planning

---

## CONCLUSION

**Atenna Guard Extension has completed its foundation (FASE 1-4) and is now in consolidation (FASE Consolidação). All critical security and compliance features are implemented. FASE 5+ focuses on extending capabilities (documents, OCR, vision).**

**Timeline: v2.30.0 (Document Upload) estimated 2026-05-20 → 2026-06-15**

