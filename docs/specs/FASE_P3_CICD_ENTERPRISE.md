# FASE P3 — CI/CD Enterprise + guarda-corpos de qualidade

**Status:** planejado · **Depende de:** FASE 9.2 (harness verde) · **Bloqueia:** republicação da extensão

## Objetivo

Nenhuma mudança chega em produção sem passar por portões automáticos. O dono é operador
solo e leigo — o pipeline é a rede de segurança. Cada portão que falha **bloqueia o merge**.

## Escopo (pedido do dono, 2026-09-02)

### 1. Testes
| Item | Ferramenta | Portão |
|---|---|---|
| **TDD como prática** | — | regra em CLAUDE.md: teste antes/junto do código, sempre (já é a regra canônica) |
| **Cobertura** | `vitest --coverage` (v8) + `pytest-cov` | gate **ratchet** (só sobe): começa no valor medido hoje, PR não pode baixar |
| **Testes de mutação** | `Stryker` (TS) + `mutmut` ou `cosmic-ray` (Python) | roda no CI semanal (não por PR — é lento); relatório publicado; meta de mutation score por módulo crítico (`dlp/`, `middleware/`, `routes/bff_auth`) |
| **Testes de carga** | `k6` (ou `locust`) contra staging | job manual + pré-release: p95 `/generate-prompts` < 8s a 20 rps, 0 5xx; `/dlp/scan` < 1s |
| **Complexidade** | `radon cc`/`radon mi` (Python) + `eslint` `complexity` rule (TS) | PR falha se função nova > CC 15 ou arquivo MI < 65 |
| **Estrutura de dependência** | `pydeps`/`import-linter` (Python) + `dependency-cruiser` (TS) | contrato de camadas: `routes/` não importa `routes/`; `dlp/` não importa `routes/`; sem ciclos |
| E2E | Playwright (extensão + api) | já existe; roda no CI contra staging |
| Contrato cliente↔servidor | JSON Schema dos Pydantic vs `bffClient.ts` | novo |

### 2. Pipeline CI (`.github/workflows/ci.yml`) — `on: [push, pull_request]`
Jobs paralelos, **todos obrigatórios** para merge:
- `lint`: `tsc --noEmit` + ESLint + `ruff` + `black --check` + `radon`/complexity
- `test-front`: `vitest run --coverage` + ratchet
- `test-back`: `pytest --cov` na imagem docker + ratchet
- `deps`: `import-linter` + `dependency-cruiser` + `npm audit`/`pip-audit`
- `build`: `npm run build` + valida `dist/` + tamanho do bundle (budget)
- `security`: `gitleaks` + CodeQL (JS+Py) + Trivy na imagem do backend
- `e2e`: Playwright headless contra staging

### 3. Bloqueio de merge (GitHub)
- **Branch protection em `main`**: PR obrigatório, todos os checks verdes, histórico linear,
  sem force-push, sem bypass de admin. `CODEOWNERS`. Template de PR com checklist
  (teste de regressão? regra server-side? spec atualizada?).
- **Secret scanning + push protection** ligados.
- **Renovate** (deps npm+pip+actions), auto-merge de patch após CI verde.

### 4. CD (`.github/workflows/release.yml`)
- `release-please` → PR de release (bump versão + CHANGELOG + tag `vX.Y.Z`).
- Tag → build imagem backend → push GHCR → **deploy staging** (SSH `compose pull && up -d`)
  → smoke → **approval manual** (GitHub Environments) → **deploy prod** → smoke pós-deploy
  → **rollback automático** (redeploy da tag anterior) se smoke falhar → notifica Discord.
- Extensão: job empacota o `.zip` da CWS como artefato; publish opcional via `chrome-webstore-upload-cli`.
- **Fim do deploy manual na VPS** (hoje: scp + rebuild + restart na mão).

### 5. Backup do banco (Supabase)
- **Supabase**: plano Pro já tem PITR? confirmar. Se Free: `pg_dump` diário via cron na VPS
  (`supabase db dump` ou `pg_dump` pela connection string direta) → arquivo cifrado (age/gpg)
  → upload pro object storage (Cloudflare R2 / Backblaze B2, free tier) → retenção 30d.
- Job de restauração testado 1×/mês (restore num schema `_restore_test`).
- Alerta se o backup do dia não rodou (GlitchTip cron monitor, igual aos jobs do scheduler).

### 6. Status das assinaturas (observabilidade de billing)
- **Painel/alerta** sobre o estado real das assinaturas:
  - nº de Pro ativos, nº `past_due`, nº que vencem em 7d, nº que renovaram/cancelaram na semana
  - **divergência `profiles.plan` ↔ `user_plans.status` ↔ `subscriptions.status`** (BUG-01 do
    `checkout-audit-spec.md`: usuário paga e fica bloqueado por dessincronia) → alerta imediato
  - webhook Asaas sem receber evento há > 48h (pode indicar quebra) → alerta
- Métricas Prometheus: `atenna_subscriptions_active{plan}`, `atenna_subscriptions_past_due`,
  `atenna_subscription_sync_mismatch_total` (job periódico compara as 3 tabelas).
- Job diário `subscription_health_check` com check-in no GlitchTip.

## Ambientes
- **staging**: subdomínio próprio, schema Supabase isolado (ou 2º projeto se orçamento permitir),
  container próprio na VPS. Usuários de teste seedados.
- **production**: atual. Deploy exige approval.

## Ordem de execução
1. FASE 9.2 — harness verde (pré-req).
2. P3.1 — CI mínimo viável: lint + test-front + test-back + build + gitleaks + branch protection.
   **Isto já destrava republicar a extensão com segurança.**
3. P3.2 — deploy automático do backend + rollback (acaba a dança manual).
4. P3.3 — cobertura (ratchet) + complexidade + estrutura de dependência.
5. P3.4 — backup do banco + restauração testada.
6. P3.5 — status das assinaturas (painel + alertas + job de sync-check).
7. P3.6 — staging + CD por tag + release-please + smoke + rollback.
8. P3.7 — mutação (semanal) + carga (pré-release) + contrato cliente↔servidor.

## Code review (3 chapéus) — por sub-fase, em `FASE_P3_*_CODE_REVIEW.md`
- **Arquiteto:** o pipeline não pode ter segredo em log; deploy SSH usa chave dedicada de CI
  (não a do dono); rollback tem que ser testado, não presumido.
- **PO:** cada portão que bloqueia merge tem que ter valor real — nada de gate cosmético que
  o dono vai querer desligar na primeira urgência.
- **PM:** billing observability (item 6) protege a receita — é o de maior ROI depois do CI mínimo.
