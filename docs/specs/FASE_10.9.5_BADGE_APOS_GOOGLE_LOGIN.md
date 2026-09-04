# FASE 10.9.5 — badge não aparece após login com Google

**Status:** em execução.
**Origem:** o dono logou com Google, entrou automático (sessão OK), mas o badge **não apareceu**
no input do ChatGPT sem recarregar a página. Com e-mail/senha funciona.

## Problema

A injeção do badge após login depende do **popup** mandar `RELAY_INJECT_BADGE` enquanto ainda
está vivo:

```
popup.doAction() → bffLogin()/bffGoogleLogin() → if (tabId && tabSupported) {
  relayInjectBadge(tabId); window.close();
}
```

No login com **Google**, `bffGoogleLogin()` chama `chrome.identity.launchWebAuthFlow`, que abre
a janela do Google. Quando o fluxo volta, **o popup já fechou** (perdeu o foco) — então
`relayInjectBadge` roda num contexto morto e a mensagem se perde. O badge só aparece no
próximo reload/navegação da aba.

O content script tem um listener próprio de `storage.onChanged` que deveria ser o fallback,
mas o dono ainda viu a falha (timing / o listener não pega em toda situação).

## Decisão

O **service worker** vira o backstop: observa `atenna_session` no `chrome.storage.local` e,
quando uma sessão **nova** aparece (`newValue && !oldValue`), manda `INJECT_BADGE` pra toda
aba já aberta em host suportado. Independe do ciclo de vida do popup — funciona pra e-mail,
Google e login pela welcome.

Os matches vêm do `manifest.content_scripts[].matches` (fonte única — o script de E2E injeta
localhost lá, então o backstop também vale nos testes).

## Arquivos

- `src/background/background.ts` — listener de `storage.onChanged` + `broadcastToSupportedTabs`.
- `tests/e2e/full-flow.spec.ts` — **F9**.
- `docs/specs/FASE_10.9.5_BADGE_APOS_GOOGLE_LOGIN.md` · `CHANGELOG.md`.

## Contrato

- Aba de IA aberta **sem** sessão → sessão surge (retorno do OAuth) → badge injeta **sozinho**,
  sem reload, em ≤ 15s.
- `oldValue && newValue` (refresh de token) **não** dispara broadcast redundante (só `!oldValue`).
- Logout (`newValue` ausente) segue tratado pelo listener do próprio content script.

## Testes

- E2E `full-flow F9` — abre fixture sem sessão (0 badge) → `injectSession` → espera
  `#atenna-guard-btn` aparecer sem recarregar. Falhava antes (dependia do popup).
- Regressão: F1–F8 seguem verdes (9/9).

## Riscos

- Baixo. Só adiciona um listener no SW; nenhum caminho existente muda. Broadcast é
  best-effort (`chrome.runtime.lastError` engolido) e só pra abas que já casam os matches
  do manifesto (permissão já concedida).
- `chrome.tabs.query({url})` exige `tabs` permission — já está no manifesto.

## Rollout

`vitest` 325 + `test:e2e` (F9 novo) → PR → merge. É mudança **só de frontend** (`dist/`),
não precisa de deploy do backend — o dono recarrega a extensão em `chrome://extensions`.
