# FASE P3.6 + P3.7 — Staging, mutação, carga, contrato

**Status:** planejado · **Parte de:** P3 CI/CD · **Não bloqueia:** republicar a extensão

---

## P3.6 — Ambiente de staging + CD por tag

### Problema
Hoje só existe `production`. Toda mudança de backend vai direto pra prod (com CI + rollback,
mas sem um passo intermediário onde e2e/carga rodam contra um ambiente real). E os testes
que dependem de Supabase (`dlp/test_retention_manager`, e2e `--project=api`) rodam contra
**produção** ou são pulados.

### Decisões
| Tema | Decisão | Porquê |
|---|---|---|
| Supabase de staging | **schema isolado `staging` no MESMO projeto** (não 2º projeto) + RLS | 2º projeto = custo + setup dobrado; schema isolado destrava e2e reais sem isso |
| Backend de staging | container `atenna-backend-staging` na MESMA VPS, porta interna, `staging.atennaia.com.br` (Cloudflare + nginx vhost) | reusa a infra; 1 registro DNS do dono |
| `.env` de staging | `/root/atenna-backend-staging/.env` — aponta pro schema `staging`, chaves de teste do Asaas/Stripe | isola dados |
| Deploy | `deploy.yml` ganha um job `deploy-staging` que roda ANTES do `deploy` (prod), sem aprovação | staging é descartável |
| Gate | após `deploy-staging`: `playwright --project=api` + `k6` smoke contra `staging.atennaia.com.br` → só então libera o `deploy` (prod) com aprovação | pega regressão antes de prod |
| CD por tag | `release-please` abre PR de release (bump `manifest.json`+`package.json`+`CHANGELOG`, tag `vX.Y.Z`). Tag → pipeline completa staging→prod | versão canônica automática |
| Extensão no CD | job empacota o `.zip` da CWS como artefato da tag; publish manual (revisão CWS à parte) | não dá pra automatizar 100% a CWS |

### Arquivos
```
.github/workflows/deploy.yml           # + job deploy-staging + gate e2e/k6
.github/workflows/release.yml           # release-please (novo)
infra/staging/docker-compose.yml        # container staging (novo)
infra/staging/nginx-staging.conf         # vhost (novo)
backend/db/migrations/xxxx_staging_schema.sql   # schema staging + RLS espelhando public
tests/load/generate-prompts.js           # k6: 20 rps, p95 < 8s, 0 5xx (novo)
release-please-config.json + .release-please-manifest.json
```

### Setup do dono
1. DNS `staging.atennaia.com.br` (CNAME → mesma coisa do `api`, Cloudflare proxied).
2. Confirmar: pode criar o schema `staging` no projeto Supabase atual? (sim — é free).

---

## P3.7 — Testes de mutação + carga + contrato

### P3.7a — Mutação (skill Trail of Bits `mutation-testing`)
Cobertura diz "a linha rodou". Mutação diz "se eu trocar `<` por `<=` nessa linha, algum teste
quebra?". Mede a **qualidade** dos testes, não a quantidade.

| Tema | Decisão |
|---|---|
| Ferramenta | `mutmut` (Python) via a skill `mutation-testing` da Trail of Bits |
| Escopo | só os módulos críticos: `backend/dlp/` (scanner, engine, enforcement), `backend/middleware/`, `backend/routes/subscription_health.py`, `backend/routes/bff_auth.py`, `backend/services/session_store.py` |
| Quando | job **semanal** no CI (`schedule: cron`), não por PR (é lento — horas) |
| Meta | mutation score ≥ 70% nos módulos de DLP/auth; relatório publicado como artefato; mutantes sobreviventes viram issue |
| Frontend | `Stryker` em `src/dlp/`, `src/core/`, `src/auth/` (semanal também) |

### P3.7b — Carga (`k6`)
- `tests/load/*.js` contra `staging`. Cenários: `/generate-prompts` (20 rps, 2 min), `/dlp/scan`
  (50 rps), `/auth/login` (10 rps). Limites: p95 `/generate-prompts` < 8s, `/dlp/scan` < 1s,
  0 respostas 5xx, error rate < 1%.
- Roda no gate de staging (P3.6) e sob demanda (`workflow_dispatch`).

### P3.7c — Contrato cliente ↔ servidor
- Gerar JSON Schema dos modelos Pydantic do backend (`backend/schemas/*` + os `BaseModel` das rotas).
- Teste no front (`src/**/*.contract.test.ts`) valida os tipos de request/response de `bffClient.ts`
  contra esse schema. Roda contra um **container do backend** real no CI (pega drift de API).
- Ferramenta: `pydantic` `.model_json_schema()` no build do backend → artefato → `ajv` no front.

### Skills / plugins usados
| Skill | Onde |
|---|---|
| `mutation-testing` (Trail of Bits) | configura o `mutmut`/`Stryker`, tune de timeout, triagem de sobreviventes |
| `property-based-testing` (Trail of Bits) | onde a mutação achar buraco: substituir exemplo fixo por `Hypothesis`/`fast-check` (parsers, scanner, comparadores) |
| `supply-chain-risk-auditor` (Trail of Bits) | job pré-release: auditoria de dependência npm+pip |
| `agentic-actions-auditor` (Trail of Bits) | auditar `deploy.yml`/`release.yml` (segredos, injeção via input) |
| `spec-to-code-compliance` (Trail of Bits) | validar cada spec `FASE_*` contra o código no PR |
| `differential-review` (Trail of Bits) | 5ª camada do pipeline em todo PR de risco |

### Ordem de execução
1. P3.6 schema `staging` + container + vhost + gate e2e/k6.
2. P3.7c contrato (destrava com o container do backend no CI).
3. P3.7b k6 (usa o staging).
4. P3.7a mutação (job semanal — pode rodar em paralelo com o resto).
5. `release-please` por último.

### Riscos
| Risco | Mitigação |
|---|---|
| schema `staging` na mesma instância Supabase → carga do k6 afeta prod | k6 só bate no backend-staging que aponta pro schema `staging`; rate baixo; janela combinada |
| mutação semanal consome minutos de Actions | escopo pequeno (só DLP/auth); `schedule` fim de semana |
| `release-please` + branch protection (PR obrigatório) | release-please abre PR normal, passa pelo CI, merge automático quando verde |
