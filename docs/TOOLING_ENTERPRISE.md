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

No Claude Code:
```
/plugin marketplace add trailofbits/skills
/plugin install <skill>@trailofbits-skills
```
(rodar `/plugin` para listar as skills disponíveis do marketplace e instalar as relevantes —
ex.: análise estática, insecure-defaults, entrypoint analysis).

Repo: https://github.com/trailofbits/skills

## 5. claude-mem — memória de longo prazo entre sessões

Captura o que o agente faz, comprime com IA e reinjeta contexto relevante em sessões futuras.
Complementa o `~/.claude/projects/.../memory/` (que é curado à mão).

No Claude Code:
```
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
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
