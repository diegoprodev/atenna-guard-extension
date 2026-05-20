# Atenna Guard — Spec Index

> Spec-driven PRDs com harness de testes para cada fase. Ordem de execução recomendada.

---

## PRDs Ativos (sequência obrigatória)

| Ordem | Fase | Arquivo | Objetivo | Status |
|-------|------|---------|----------|--------|
| 1 | **4.6** | [FASE_4.6_SECURITY_HARDENING_PRD.md](FASE_4.6_SECURITY_HARDENING_PRD.md) | BFF Auth Proxy, AES-GCM token, sender guard, XSS fix, CSP | 🔴 Pendente |
| 2 | **4.7** | [FASE_4.7_UI_ENTERPRISE_POLISH_PRD.md](FASE_4.7_UI_ENTERPRISE_POLISH_PRD.md) | Refresh race fix, popup skeleton, modal split, esqueci-senha confirmation | 🔴 Pendente |
| 3 | **5.1** | [FASE_5.1_RLS_AUDIT_BFF_COMPLETE_PRD.md](FASE_5.1_RLS_AUDIT_BFF_COMPLETE_PRD.md) | RLS em todas as tabelas, quota server-side, middleware opaque-only | 🔴 Pendente |

---

## PRDs Anteriores (referência)

| Fase | Arquivo | Status |
|------|---------|--------|
| 4.1 | [FASE_4.1_MULTIMODAL_EXECUTION_SPEC.md](FASE_4.1_MULTIMODAL_EXECUTION_SPEC.md) | ✅ Completo |
| 4.2A | [FASE_4.2A_REAPROVEITAMENTO_DLP_ATENNA_PLATFORM_PARA_ATENNA_SAFE.md](FASE_4.2A_REAPROVEITAMENTO_DLP_ATENNA_PLATFORM_PARA_ATENNA_SAFE.md) | ✅ Completo |
| 4.2B | [FASE_4.2B_DOCUMENT_LIMITS_MATRIX.md](FASE_4.2B_DOCUMENT_LIMITS_MATRIX.md) | ✅ Completo |
| 4.5 | [../superpowers/plans/FASE-4.5-ENTERPRISE-PDF-EXTRACTION.md](../superpowers/plans/FASE-4.5-ENTERPRISE-PDF-EXTRACTION.md) | ✅ Completo |

---

## Roadmap Restante (PRDs a criar nas próximas sessões)

| Fase | Objetivo |
|------|----------|
| 5.2 | PT-BR Enterprise Recognizers (RG, CNH, OAB, Placa, Endereço) |
| 5.3 | Playwright E2E Suite (6+ tests, extensão carregada) |
| 6.1 | OCR + Image DLP (EasyOCR + presidio-image-redactor) |
| 6.2 | Compliance Dashboard + Audit Trail |
| 6.3 | Governance Layer (policies por departamento) |

---

## Harness Master Checklist

Todos os invariantes de segurança devem estar GREEN antes de cada release:

| ID | Invariante | Fase |
|----|-----------|------|
| SI-1 | ZIP sem supabase.co ou ANON key | 4.6 |
| SI-2 | storage sem raw JWT | 4.6 |
| SI-3 | sender.id validado em background.ts | 4.6 |
| SI-4 | innerHTML sem dados de usuário | 4.6 |
| SI-5 | SERVICE_ROLE nunca em logs | 4.6 |
| SI-6 | Token refresh serializado | 4.6 + 4.7 |
| SI-7 | RLS em todas as tabelas de usuário | 5.1 |
| SI-8 | Free plan → 429 após 10 calls/dia | 5.1 |
| SI-9 | Quota em Supabase (não client-only) | 5.1 |
| SI-10 | dlp_events isolado por user_id | 5.1 |
