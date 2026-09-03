# FASE 10.7 — Validação real E2E + correções do que quebrou no uso

**Status:** implementado · **Gatilho:** o dono carregou a extensão sem compactação e
achou vários problemas que passaram no "renderizou" e falharam no uso real.

## O que estava errado (e o diagnóstico honesto)

| Sintoma | Causa real | Ação |
|---|---|---|
| Popup escuro, sem contraste, emoji | Popup **antigo** — a build carregada era anterior ao #32 | Nada — #32 já corrige (mergeado) |
| "não vi boas-vindas" | `background.ts` só abre `welcome.html` em `reason === 'install'`; reload em dev = `update` | `onInstalled` idempotente (flag `atenna_welcomed`). **Em dev tem que remover e re-adicionar a extensão** — "recarregar" não dispara `install` |
| **"abrir atenna" / "gerar prompt" → onboarding travado; "Começar" não faz nada; ícone SVG estrela** | 3º onboarding (wizard de 5 slides) no modal in-page. Só marcava `onboarding_seen` no **servidor**; quando o POST falhava (rota/coluna/rede), aparecia pra sempre e bloqueava o painel | **wizard removido**. O modal abre **direto no Refinar**. Onboarding é a welcome.html + o 1º-run do popup, não um 3º lugar |
| Login Google trava no botão | Extensão sem compactação → **ID aleatório** ≠ do publicado → `redirect_to` fora da allowlist do Supabase → `launchWebAuthFlow` fica pendurado | **timeout de 120s** → falha limpa + botão volta. Fix definitivo (`"key"` no manifest) depende do dono pegar a chave no CWS |
| chatgpt.com sem opção de login | **Por design**: deslogado, a extensão não mostra nada na página | **Mantido** (decisão do dono). O caminho de login é o ícone da extensão |
| "configurações mostra que estou logado sem eu ter logado" | Sessão real persistida no `chrome.storage` de um login anterior — "recarregar" a extensão não limpa | **Não é bug.** Pra testar deslogado: "Sair" ou remover+re-adicionar. |
| Ícone da extensão deslogado | Já mostrava o form de login cru (#29) | **+ mensagem amigável** de valor ("faça login para liberar a proteção de dados e a geração de prompts") |
| "badge" na copy | Jargão | trocado por "botão da Atenna" (#32) |

## Mudanças

```
CLAUDE.md                        # REGRA: validação real ponta a ponta (não "renderizou")
src/popup.ts                     # mensagem amigável no login (ap-login-sub), troca no signup
popup.html                       # .ap-login-sub
src/background/background.ts     # welcome-on-install idempotente (flag atenna_welcomed)
src/auth/bffClient.ts            # launchAuthFlowWithTimeout — Google não pendura mais
src/ui/modal/core.ts             # REMOVE o wizard de onboarding de 5 slides do modal
scripts/add-localhost-e2e.mjs    # + localhost em web_accessible_resources (logo carrega no fixture)
playwright.config.ts             # projeto extension inclui full-flow.spec
tests/e2e/full-flow.spec.ts      # F1–F5: deslogado→login→badge→modal→gerar→config→sair (NOVO)
tests/e2e/welcome.spec.ts        # W7 reescrito (auto-login) + W7b (fallback manual)
tests/e2e/extension.spec.ts      # P1/P2/P3 — popup no Chromium real
```

## Ainda pendente (FASE 10.3)
O **modal in-page** (`src/ui/modal/*` + `modal.css`) continua no tema escuro antigo, com emoji
e "cara de IA" — a tela de configurações que o dono viu. É a próxima superfície do redesign.
Esta fase só **consertou o fluxo** (wizard travado); o redesign visual é a 10.3.

## Regra nova (CLAUDE.md)
Screenshot de `<style>` isolado / harness stubado / http-server **não valida**. Toda mudança
em popup/content/background/welcome/modal/auth só é "pronta" depois de:
`npm run build` + `playwright test --project=extension` (carrega o `dist/` real) + 1 teste
E2E novo por comportamento + rodar `npm run test:e2e` e reportar o número real. O que não
dá pra automatizar (OAuth Google real), dizer explicitamente.

## Validação (real)
- `npm run test:e2e` → **32 passaram · 0 falharam · 1 skip** — carrega o `dist/` de verdade no
  Chromium e dirige:
  - welcome (W1–W15), signup → auto-login (W7/W7b)
  - badge só aparece logado (T3), badge após login (T4), DLP/CPF (T5/T7), modal abre (T6/T8)
  - popup: deslogado → login + mensagem, **não some** (P1); logado → home (P2); signup troca a msg (P3)
  - **fluxo ponta a ponta (F1–F5): deslogado → sem badge / popup com login → login grava sessão →
    badge aparece → clicar abre o Refinar SEM wizard → digitar + Refinar gera os 3 cards →
    Configurações mostra o email → Sair remove o badge**
- `vitest` 317 ✓ · build limpo.
- **NÃO testado E2E:** login Google real (precisa do ID publicado / `"key"` no manifest) —
  coberto só o caminho de erro (timeout). O `/generate-prompts` real sai do service worker;
  o F4 valida que os cards renderizam (com o fallback local quando o mock não alcança o SW).

## Login Google — ID estável (feito)
- **`"key"` adicionado ao `manifest.json`** → o ID da extensão sem compactação agora é
  **determinístico**: `eeejlbiagiieioangpmhhfjlnpphljao` (antes era aleatório a cada load).
- Chave **pública** no manifest (não é segredo — vai em toda extensão instalada).
  Chave **privada**: `.keys/atenna-extension-dev.pem` — **gitignored**, fora do repo.
- `strip-localhost.mjs` **não** remove o `key` (o `dist/` de dev precisa dele). Ao subir na CWS:
  o item já publicado usa a chave original da 1ª submissão — o `key` do zip é ignorado pra
  updates. Se a CWS reclamar do campo, remover só do zip.

### Pendência do dono — 1 paste no Supabase
Adicionar em **Supabase → Authentication → URL Configuration → Redirect URLs**:
```
https://eeejlbiagiieioangpmhhfjlnpphljao.chromiumapp.org/
```
Sem isso o "Entrar com Google" na extensão sem compactação ainda falha (agora com timeout
limpo em vez de travar). Na extensão **publicada** o Google já funciona (ID/redirect da CWS).
