<!-- Padrão canônico 9.5 — ver CLAUDE.md -->

## O que muda

<!-- 1-3 linhas: o que era, o que quebrava, o que passa a fazer -->

## Checklist (obrigatório)

- [ ] **Spec** em `docs/specs/FASE_X_*.md` (problema, decisões, arquivos, contrato, riscos, rollout)
- [ ] **Teste comportamental** por feature nova
- [ ] **Teste de regressão** por bug corrigido — *falha antes do fix*
- [ ] **Teste de bypass** por regra de segurança nova
- [ ] Toda regra de negócio/segurança é imposta **server-side** (o cliente é território hostil)
- [ ] **Code review** dos 3 chapéus registrado (arquiteto / PO / PM) — `FASE_X_CODE_REVIEW.md`
- [ ] **CHANGELOG.md** atualizado (o que era, o que quebrava, o que mudou, como validou, nº de testes)
- [ ] Harness: `npx vitest run` + `pytest` = **0 falhas** (nº: ___)
- [ ] `npm run build` limpo

## Como foi validado

<!-- comandos rodados + resultado real (nº de testes, smoke, e2e) -->
