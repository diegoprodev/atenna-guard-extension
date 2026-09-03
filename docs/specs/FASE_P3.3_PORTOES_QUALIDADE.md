# FASE P3.3 — Portões de qualidade no CI

**Status:** em implementação · **Parte de:** P3 CI/CD

## Problema

O CI hoje só checa "os testes passam" e "o build funciona". Não impede:
- código novo **sem teste** (cobertura despenca sem ninguém ver)
- funções-monstro (complexidade ciclomática alta → impossível de testar/manter)
- violação de camadas (`routes/` importando `routes/`, `dlp/` importando `routes/`, ciclos)

## Decisões

| Portão | Ferramenta | Regra | Bloqueia? |
|---|---|---|---|
| **Cobertura — backend** | `pytest-cov` | **ratchet**: `%` novo ≥ baseline commitado (`.coverage-baseline`). Sobe → atualiza baseline. | sim |
| **Cobertura — frontend** | `@vitest/coverage-v8` | idem, baseline em `.coverage-baseline-front` | sim |
| **Complexidade — backend** | `radon cc -n C` | nenhum bloco **novo** com rank pior que C (CC > 10). Existentes: relatório, não bloqueia (dívida) | parcial |
| **Estrutura de dependência — backend** | `import-linter` | contrato de camadas + zero ciclos | sim |
| **Estrutura de dependência — frontend** | `dependency-cruiser` | sem ciclos; `dlp/` não importa `ui/` | sim |
| **Segurança dos workflows** | ToB `agentic-actions-auditor` (manual) + pin de actions | actions pinadas por versão major (Dependabot cuida) | — |
| **Supply chain** | ToB `supply-chain-risk-auditor` (manual, pré-release) | sem dependência abandonada/typosquat | — |

### Contrato de camadas (`backend/.importlinter`)
```
[importlinter]
root_package = backend  (via --rcfile no CI, rodando de dentro de backend/)

# 1. sem ciclos em lugar nenhum
[importlinter:contract:sem-ciclos]
type = independence   # na verdade: layers com todos os módulos → detecta ciclo

# 2. o motor de DLP não conhece a web
[importlinter:contract:dlp-nao-importa-rotas]
type = forbidden
source_modules = dlp
forbidden_modules = routes, middleware

# 3. rota não chama rota (exceto o pacote routes/admin que é 1 router agregado)
[importlinter:contract:rota-nao-importa-rota]
type = forbidden
source_modules = routes.generate, routes.dlp, routes.checkout
forbidden_modules = routes.auth, routes.bff_auth
```
*(ajustar aos imports reais — pode haver violação legada; nesse caso `ignore_imports` + issue.)*

## Como o ratchet funciona (sem serviço externo tipo Codecov)

1. `.coverage-baseline` (ex: `62.4`) commitado.
2. CI: roda cobertura → extrai `%` → `python -c "exit(0 if novo >= float(open('.coverage-baseline').read()) - 0.5 else 1)"`.
   (margem de 0.5 p/ ruído de arredondamento.)
3. Se subiu ≥ 1 ponto: CI escreve o novo valor e **comenta no PR** "atualize o baseline p/ X".
   (não commita sozinho — o dev atualiza.)

## Arquivos

```
.github/workflows/ci.yml         # + steps de cobertura/complexidade/deps nos jobs frontend/backend
.coverage-baseline               # backend (novo)
.coverage-baseline-front         # frontend (novo)
backend/.importlinter            # contrato de camadas (novo)
backend/requirements-dev.txt     # + import-linter, radon
package.json                     # + @vitest/coverage-v8, dependency-cruiser (devDeps)
.dependency-cruiser.cjs          # regras TS (novo)
docs/specs/FASE_P3.3_*.md
```

## Rollout

1. Medir baseline real (rodar cobertura local/CI 1×).
2. Adicionar deps + configs. Ajustar contratos de camada aos imports reais (pode ter violação legada → `ignore_imports` + follow-up).
3. Adicionar steps no `ci.yml` (cobertura bloqueante, complexidade relatório).
4. PR. Confirmar CI verde. Rodar `supply-chain-risk-auditor` e `agentic-actions-auditor` no diff.
5. CHANGELOG.
