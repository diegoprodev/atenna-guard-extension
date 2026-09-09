# FASE B13.2 — badge sem "pisca" + permissões mínimas pra republicar

**Status:** spec · aprovado pelo dono 2026-09-09
**Não bloqueia:** nada — melhora a taxa de instalação (tira o aviso "ler histórico") e o polimento do badge.

## Problema

1. **Badge "pisca" no canto.** Ao abrir uma plataforma de IA, o badge de espera (B13,
   `injectFallbackButton`) aparece imediato no canto inferior direito e só ~3s depois é
   trocado pelo badge completo ancorado no input. Numa carga normal o composer monta em
   1–3s — o badge de espera não devia aparecer nesse caso, só quando o composer realmente
   não vem (usuário não logado na plataforma).

2. **Permissão `tabs`** gera o aviso **"Ler seu histórico de navegação"** no diálogo de
   instalação. Ninguém quer instalar extensão que lê histórico. A extensão só precisa
   saber o domínio da **aba ativa quando o usuário clica no ícone** — isso é `activeTab`.

3. **`chat.openai.com`** — domínio legado (ChatGPT é `chatgpt.com` desde 2024; o velho só
   redireciona). Está em `host_permissions`, `content_scripts.matches` e
   `web_accessible_resources` sem servir pra nada — só polui o diálogo de permissão.

## Decisões

| Tema | Decisão | Porquê |
|---|---|---|
| Badge de espera | Só injeta depois de **2,5s** sem o composer (grace period no `tryInjectWithRetry`) | mata o "pisca" na carga normal; mantém o fallback pra quem não logou na plataforma |
| `tabs` → `activeTab` | troca no `permissions` | `activeTab` dá a URL da aba ativa **só no clique do ícone** — exatamente quando o `popup.ts` precisa. Sem aviso de histórico. |
| `broadcastToSupportedTabs` | `tabs.query({url:…})` → `tabs.query({})` + `sendMessage` em todas | sem `tabs`, `query({url})` tem comportamento ambíguo; `query({})` só devolve `.id` (que é tudo que usamos) e o content script só existe nas IAs — resto falha silencioso |
| `welcome.ts notifyBadgeInject` | manda `{type:'BROADCAST_INJECT_BADGE'}` pro background | a welcome não tem `activeTab`; o background já tem o broadcast |
| `chat.openai.com` | remove de manifest (3 lugares) + `SUPPORTED_HOSTS` (2) + checagens `.includes` (2) | legado morto |
| `identity`, `storage` | mantêm | `identity` = login Google (`launchWebAuthFlow`); `storage` = sessão + prefs + contador |

## Arquivos

| Arquivo | Mudança |
|---|---|
| `manifest.json` | `permissions: ["storage","activeTab","identity"]`; remove `chat.openai.com/*` de `host_permissions`, `content_scripts[0].matches`, `web_accessible_resources[0].matches` |
| `src/content/content.ts` | `tryInject(allowFallback=false)`; `tryInjectWithRetry` passa `elapsedMs >= FALLBACK_GRACE_MS` |
| `src/background/background.ts` | `broadcastToSupportedTabs` usa `tabs.query({})`; novo handler `BROADCAST_INJECT_BADGE` |
| `src/welcome/welcome.ts` | `notifyBadgeInject` manda mensagem pro background; `SUPPORTED_HOSTS` sem `chat.openai.com` |
| `src/popup.ts` | `SUPPORTED_HOSTS` sem `chat.openai.com`; `getActiveTabId` com `currentWindow:true` |
| `src/content/detectInput.ts` | tira `|| host.includes('chat.openai.com')` |
| `src/ui/modal/upload-flow.ts` | idem |
| `docs/CWS_PERMISSION_JUSTIFICATIONS.md` | novo — texto pronto pros campos da CWS |

## Contrato

- Diálogo de permissão na instalação passa a ser: *"Ler e alterar seus dados em `chatgpt.com`,
  `claude.ai`, `gemini.google.com`, `perplexity.ai`, `api.atennaia.com.br`, `supabase.co`"* —
  **sem** "Ler seu histórico de navegação".
- Popup logado numa aba de IA continua mostrando "ChatGPT — protegido e ativo" (via `activeTab`).
- Badge: numa carga normal, aparece **direto no input** (sem passar pelo canto). Se o composer
  não vier em 2,5s (não logado na plataforma) → badge de espera no canto, como antes.
- Login Google (welcome + popup) continua injetando o badge nas abas de IA abertas.

## Harness

`tests/e2e/full-flow.spec.ts` + `tests/e2e/extension.spec.ts`:
- **F9** (badge aparece na aba já aberta quando a sessão surge) — tem que continuar verde
  com o `tabs.query({})` novo.
- **F13** (badge aparece sem composer) — continua verde; o de espera aparece ~2,5s depois.
- **F14** (composer só muda opacity) — inalterado (input existe, só invisível — não passa
  pelo branch do fallback).
- **F15 (novo):** carga normal (fixture com composer) → badge injeta **no input** e o
  `data-atenna-fallback` **nunca** aparece no DOM (sem pisca).
- Unit `background.test`: mensagem `BROADCAST_INJECT_BADGE` → `broadcastToSupportedTabs` chamado.
- Unit `manifest`: `permissions` sem `tabs`, com `activeTab`; sem `chat.openai.com`.
- `npm run test:e2e` completo — reportar número real.

## 3 chapéus

- **Arquiteto:** `activeTab` é estritamente menos poder que `tabs` — não há regressão de
  segurança, só de conveniência (popup em janela sem foco). `tabs.query({})` expõe menos
  (só ids). `BROADCAST_INJECT_BADGE` passa pelo guard `sender.id === chrome.runtime.id`.
- **PO:** o dono pediu — "ninguém instala extensão que lê histórico". O badge sem pisca é
  polimento que o dono relatou. Fricção do free intacta.
- **Estrategista:** reduzir permissão = mais instalação = mais topo de funil pra esteira
  Plataforma. Alinhado.

## Riscos

| Risco | Mitigação |
|---|---|
| `activeTab` não concedido em janela sem foco → popup mostra estado genérico | degradação aceitável; validar no Chrome real |
| `tabs.query({})` sem `tabs` não devolver nada em algum Chrome antigo | improvável (query básica sempre funciona); F9 cobre |
| Grace de 2,5s: quem não logou na plataforma espera 2,5s pelo badge de espera | invisível na prática; o badge de espera é edge case |
| CWS re-review por mudar permissão | mudança é REDUÇÃO — review tende a ser rápido; justificativas prontas no doc |

## Rollout

1. Implementa tudo, `npm run build` + `npm run test:e2e` verde.
2. Carrega `dist/` no Chrome real → confere diálogo de permissão + popup + badge sem pisca.
3. CHANGELOG + commit + PR + merge.
4. Novo zip 2.3.0 (ou 2.3.1) → dono sobe na CWS com as justificativas do doc.
