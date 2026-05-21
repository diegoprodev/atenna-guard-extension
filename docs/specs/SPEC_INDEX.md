# Atenna Guard — Spec Index

> Spec-driven PRDs com harness de testes para cada fase. Ordem de execução recomendada.

---

## PRDs Ativos (sequência obrigatória)

| Ordem | Fase | Arquivo | Objetivo | Status |
|-------|------|---------|----------|--------|
| 1 | **4.6** | [FASE_4.6_SECURITY_HARDENING_PRD.md](FASE_4.6_SECURITY_HARDENING_PRD.md) | BFF Auth Proxy, AES-GCM token, sender guard, XSS fix, CSP | ✅ Completo |
| 2 | **4.7** | [FASE_4.7_UI_ENTERPRISE_POLISH_PRD.md](FASE_4.7_UI_ENTERPRISE_POLISH_PRD.md) | Refresh race fix, popup skeleton, modal split, esqueci-senha confirmation | ✅ Completo |
| 3 | **5.1** | [FASE_5.1_RLS_AUDIT_BFF_COMPLETE_PRD.md](FASE_5.1_RLS_AUDIT_BFF_COMPLETE_PRD.md) | RLS em todas as tabelas, quota server-side, middleware opaque-only | ✅ Completo |
| 4 | **5.2** | [FASE_5.2_PTBR_ENTERPRISE_RECOGNIZERS_PRD.md](FASE_5.2_PTBR_ENTERPRISE_RECOGNIZERS_PRD.md) | PT-BR Enterprise Recognizers: RG, CNH, OAB, Placa, CRM | ✅ Completo |
| 5 | **5.3** | [FASE_5.3_PLAYWRIGHT_E2E_PRD.md](FASE_5.3_PLAYWRIGHT_E2E_PRD.md) | Playwright E2E Suite — extensão carregada, 6 testes reais (T1–T6) | ✅ Completo |
| 6 | **6.1** | [2026-05-20-fase-6.1-ocr-image-dlp.md](../superpowers/plans/2026-05-20-fase-6.1-ocr-image-dlp.md) | OCR + Image DLP + Enterprise Guardrails (EasyOCR, Presidio, prompt injection defense) | ✅ Completo |

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
| **6.2** | **Compliance Dashboard + Audit Trail** — página admin com eventos DLP por usuário, filtros por período/tipo, exportação CSV, gráficos de tendência |
| 6.3 | Governance Layer (policies por departamento, regras customizáveis por empresa) |
| 6.4 | Multi-tenant (organizações, seats, convites, billing) |

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
| SI-11 | RG detectado em texto simples e contexto rotulado | 5.2 |
| SI-12 | CNH detectado com label ou 11 dígitos em contexto | 5.2 |
| SI-13 | OAB detectado com sufixo de estado (OAB/SP 123456) | 5.2 |
| SI-14 | Placa detectada em Mercosul (ABC1D23) e formato antigo (ABC-1234) | 5.2 |
| SI-15 | Frontend e backend retornam mesmos tipos para mesmo input | 5.2 |
| SI-16 | Extensão carrega sem erros (service worker registra) | 5.3 |
| SI-17 | Badge não aparece sem autenticação | 5.3 |
| SI-18 | Badge aparece após sessão injetada | 5.3 |
| SI-19 | DLP banner aparece ao digitar CPF | 5.3 |
| SI-20 | Modal abre ao clicar no badge, fecha com ESC | 5.3 |
| SI-21 | Imagem colada com CPF em texto → banner DLP aparece | 6.1 |
| SI-22 | `/dlp/image` retorna `risk_level: HIGH` para screenshot com CPF | 6.1 |
| SI-23 | CF Gateway registra `user_id` em metadata em toda chamada `/generate-prompts` | 6.1 |
| SI-24 | Admin panel usa token BFF opaco — nenhum JWT Supabase bruto aceito | 6.1 |
| SI-25 | Custo na tabela admin reflete apenas requests identificados por `user_id` (zero distribuição igualitária) | 6.1 |
