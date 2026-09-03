# Tooling enterprise — o pipeline de validação

> **A ordem importa.** O Claude implementa, mas 4 camadas independentes decidem se está pronto:
>
> `Claude implementa` → `Playwright testa o navegador` → `TestSprite verifica os fluxos`
> → `Code Review revisa as alterações` → `Trail of Bits procura vulnerabilidades`
>
> Cada camada que aponta problema **bloqueia** o "pronto". Ver a REGRA CANÔNICA no `CLAUDE.md`.

Instalação: rodar os comandos abaixo **uma vez** (fora do agente — no terminal do Claude Code
ou no shell). Depois disso o pipeline fica disponível em toda sessão.

---

## 1. Playwright (browser) — MCP + testes

Já usamos `npx playwright test` (extensão + api). O **MCP Playwright** adiciona inspeção
interativa do navegador durante o desenvolvimento.

- **Config do MCP:** já versionada em `.mcp.json` na raiz do projeto (`playwright` →
  `npx @playwright/mcp@latest`). O Claude Code pede aprovação na primeira vez.
- **Testes (já existem):** `npm run test:e2e` (build + localhost + Playwright) e
  `npx playwright test --project=api`.

## 2. TestSprite — verifica os fluxos (MCP)

Gera e roda testes de fluxo end-to-end e reporta cobertura de caminho crítico.

1. Criar conta em https://www.testsprite.com → **API Keys** → copiar a chave.
2. Exportar a chave no ambiente (NÃO commitar):
   - Windows (PowerShell, permanente): `setx TESTSPRITE_API_KEY "sk-..."`
   - ou adicionar `TESTSPRITE_API_KEY=sk-...` a um `.env` que o shell carrega.
3. A config do MCP já está em `.mcp.json` (`testsprite` → `npx @testsprite/testsprite-mcp@latest`,
   lê `${TESTSPRITE_API_KEY}`).
4. Reabrir o Claude Code → aprovar o servidor `testsprite`.
5. Uso: "teste este projeto com o TestSprite" após uma mudança.

Docs: https://docs.testsprite.com/mcp/getting-started/installation

## 3. Code Review — revisa as alterações (plugin oficial Anthropic)

Fleet de agentes independentes revisa o diff da branch (bugs, regressões, edge cases,
conformidade com `CLAUDE.md`), com confidence score. Complementa o review dos 3 chapéus.

No Claude Code (slash commands):
```
/plugin marketplace add anthropics/claude-plugins-official
/plugin install code-review@claude-plugins-official
```
Reiniciar o Claude Code. Uso: `/code-review` (revisa o diff local) ou `/code-review <PR#>`.

Docs: https://code.claude.com/docs/en/code-review

## 4. Trail of Bits — procura vulnerabilidades (marketplace de skills)

Skills de auditoria de segurança (injeção, authz, deserialização, cripto, path traversal,
SSRF, secrets, regras Semgrep).

Marketplace: **`trailofbits/skills`** (`/plugin marketplace add trailofbits/skills` — já adicionado
como `trailofbits`). Cada skill vive em `github.com/trailofbits/skills/tree/main/plugins/<nome>`.

Skills relevantes p/ ESTE projeto (Python FastAPI + extensão Chrome TS, SaaS de DLP).
**Instalar (a camada de segurança do pipeline + o que o P3 pede):**
```
/plugin install differential-review@trailofbits       # ⭐ audita o DIFF atrás de vuln + blast radius — o núcleo desta camada
/plugin install insecure-defaults@trailofbits         # creds hardcoded, fallback secrets, defaults fracos de auth
/plugin install static-analysis@trailofbits           # Semgrep + CodeQL + SARIF
/plugin install supply-chain-risk-auditor@trailofbits # risco de dependências npm + PyPI (P3)
/plugin install modern-python@trailofbits             # boas práticas Python
/plugin install spec-to-code-compliance@trailofbits   # confere o código contra o spec (docs/specs/FASE_*)
/plugin install mutation-testing@trailofbits          # campanhas de mutação (P3)
/plugin install property-based-testing@trailofbits    # Hypothesis / fast-check (P3)
/plugin install agentic-actions-auditor@trailofbits   # audita os workflows do GitHub Actions (P3)
```
**Opcionais (aprofundam o review):** `sharp-edges`, `fp-check`, `variant-analysis`, `semgrep-rule-creator`, `trailmark`, `git-cleanup`.

**NÃO instalar** (smart contract / C++ / Rust / cripto de baixo nível / irrelevante):
`building-secure-contracts`, `entry-point-analyzer`, `dimensional-analysis`, `constant-time-analysis`,
`zeroize-audit`, `c-review`, `rust-review`, `modern-cpp`, `dwarf-expert`, `yara-authoring`,
`firebase-apk-scanner`, `burpsuite-project-parser`, `writing-lean-proofs`, `second-opinion` (precisa de CLI OpenAI/Google).

## 5. claude-mem — memória de longo prazo entre sessões

Captura o que o agente faz, comprime com IA e reinjeta contexto relevante em sessões futuras.
Complementa o `~/.claude/projects/.../memory/` (que é curado à mão).

No Claude Code (marketplace `thedotmack` já adicionado):
```
/plugin install claude-mem@thedotmack
```
Reiniciar o Claude Code. (NÃO usar `npm install -g claude-mem` — não registra os hooks.)

Docs: https://docs.claude-mem.ai/installation

---

## Ordem de execução numa entrega

1. Claude: spec → código → testes → `npx vitest run` + `pytest` verdes.
2. `npm run test:e2e` + `npx playwright test --project=api` verdes.
3. TestSprite nos fluxos tocados.
4. `/code-review` no diff.
5. Trail of Bits: rodar a skill de auditoria no diff.
6. Só então: CHANGELOG → commit → push → deploy.
