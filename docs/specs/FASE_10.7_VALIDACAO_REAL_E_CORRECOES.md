# FASE 10.7 — Validação real E2E + correções do que quebrou no uso

**Status:** implementado · **Gatilho:** o dono carregou a extensão sem compactação e
achou vários problemas que passaram no "renderizou" e falharam no uso real.

## O que estava errado (e o diagnóstico honesto)

| Sintoma | Causa real | Ação |
|---|---|---|
| Popup escuro, sem contraste, emoji | Popup **antigo** — a build carregada era anterior ao #32 | Nada — #32 já corrige (mergeado) |
| "não vi boas-vindas" | `background.ts` só abre `welcome.html` em `reason === 'install'`; reload em dev = `update` | **fallback**: 1ª vez que o popup abre sem sessão e `atenna_welcomed` não está setado → abre o welcome uma vez |
| Login Google trava no botão | Extensão sem compactação → **ID aleatório** ≠ do publicado → `redirect_to` fora da allowlist do Supabase → `launchWebAuthFlow` fica pendurado | **timeout de 120s** em `launchWebAuthFlow` → falha limpa + botão volta. Fix definitivo (`"key"` no manifest) depende do dono pegar a chave no CWS |
| chatgpt.com sem opção de login | **Por design**: deslogado, a extensão não mostra nada na página | **Mantido** (decisão do dono). O caminho de login é o ícone da extensão |
| Ícone da extensão deslogado | Já mostrava o form de login cru (#29) | **+ mensagem amigável** de valor ("faça login para liberar a proteção de dados e a geração de prompts") |
| "badge" na copy | Jargão | trocado por "botão da Atenna" (#32) |

## Mudanças

```
CLAUDE.md                        # REGRA: validação real ponta a ponta (não "renderizou")
src/popup.ts                     # mensagem amigável no login + fallback welcome
popup.html                       # .ap-login-sub
src/background/background.ts     # welcome-on-install idempotente (flag atenna_welcomed)
src/auth/bffClient.ts            # launchAuthFlowWithTimeout — Google não pendura mais
src/__tests__/popup-auth-flow.test.ts   # stub chrome.tabs.create
tests/e2e/welcome.spec.ts        # W7 reescrito (auto-login) + W7b (fallback manual)
tests/e2e/extension.spec.ts      # P1/P2/P3 — popup no Chromium real
```

## Regra nova (CLAUDE.md)
Screenshot de `<style>` isolado / harness stubado / http-server **não valida**. Toda mudança
em popup/content/background/welcome/modal/auth só é "pronta" depois de:
`npm run build` + `playwright test --project=extension` (carrega o `dist/` real) + 1 teste
E2E novo por comportamento + rodar `npm run test:e2e` e reportar o número real. O que não
dá pra automatizar (OAuth Google real), dizer explicitamente.

## Validação (real)
- `npm run test:e2e` → **27 passaram, 0 falharam, 1 skip** — carrega a extensão de verdade
  no Chromium e dirige: welcome (W1–W15), badge após login (T3–T8), signup auto-login
  (W7/W7b), **popup deslogado mostra login + mensagem e não some (P1)**, popup logado
  mostra home (P2), signup troca a mensagem (P3).
- `vitest` 317 ✓ · build limpo.
- **NÃO testado E2E:** login Google real (precisa do ID publicado / `"key"` no manifest) —
  coberto só o caminho de erro (timeout).

## Pendências pro dono
1. CWS → Package → "View public key" → me manda a string → `"key"` no `manifest.json`
   (ID local == publicado → Google funciona sem compactação).
2. Alternativa: adicionar o `chromiumapp.org` do ID de dev em Supabase → Auth → URL Config.
