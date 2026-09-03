# FASE 10 — Design system + onboarding

**Status:** em implementação · **Skills:** `impeccable`, `frontend-design`, `artifact-design`
**Não bloqueia:** republicar (mas o dono quer isto antes de divulgar)

---

## Parte 0 — Bug corrigido (pré-requisito, já feito)

**"Clico no ícone sem login → aparece skeleton e some."**
`src/popup.ts::initPopup()`: renderizava skeleton, `await bffMe()`, e quando não havia sessão:
site suportado → `sendMessage(OPEN_LOGIN_MODAL)` + `window.close()`; site qualquer →
`renderUnsupportedSiteMessage` (sem opção de login). `renderLogin()` existia mas nunca era
chamado nesse caminho.

Fix: `!me` → `renderLogin(container, tabId, supported)` **dentro do popup**, sem fechar.
+ `bffMe()` retorna `null` na hora se não há sessão local (mata o round trip → mata o flash).
Repro: `src/__tests__/popup-auth-flow.test.ts` (2 casos, falhavam antes).

---

## Parte 1 — Nota do onboarding: **6.5 / 10**

Fluxo: instala → `background.ts` abre `welcome.html` → login/signup → `showSuccess` (com links
de plataforma) → 1º clique no ícone numa IA → `popup.renderOnboarding` (com links de plataforma).

| # | Achado | Sev | Ação |
|---|---|---|---|
| O1 | **Signup = 2 passos**: "criar conta" → "agora faça login". O backend já cria confirmada (`email_confirm=True`) — não precisa. | Alta | **feito**: auto-login após signup no `welcome.ts` (fallback p/ manual se falhar) |
| O2 | Popup flash-and-close sem login | Alta | **feito** (Parte 0) |
| O3 | **Dois onboardings** quase iguais: `welcome.html#w-success` e `popup.renderOnboarding` — ambos "abra uma plataforma". Redundante e mantido em 2 lugares. | Média | unificar: welcome = onboarding completo; popup 1º-run = 1 card "abra o ChatGPT" + link, sem repetir tudo |
| O4 | Nenhuma imagem/preview do **badge** — o usuário não sabe o que procurar no campo de texto | Média | 1 screenshot/ilustração "é assim que aparece" no welcome success |
| O5 | Welcome não fecha nem redireciona sozinho após sucesso — fica uma aba órfã | Baixa | após clicar numa plataforma, `window.close()` a aba welcome (já faz no popup, não no welcome) |
| O6 | Sem estado de "instalou, nunca logou, fechou tudo" — só descobre a extensão se lembrar de clicar no ícone | Baixa | badge de "ação necessária" no ícone (`chrome.action.setBadgeText`) até 1º login |
| O7 | `renderOnboarding` marca `atenna_onboarded` só no CTA "Continuar" — se fechar antes, repete | Baixa | marcar ao abrir qualquer plataforma também |

---

## Parte 2 — Auditoria de design (a "cara de IA")

O login (`welcome.html`) tem os tells clássicos de UI gerada:

| Tell | Onde | Fix |
|---|---|---|
| **Split hero + form** genérico (painel colorido à esquerda, form à direita) | welcome | manter o split, mas dar personalidade: tipografia com caráter, o painel conta 1 ideia forte (não 3 bullets), grão/textura sutil da marca |
| **Gradiente verde padrão** `linear-gradient(150deg,#16a34a,#15803d,#14532d)` | welcome, auth/callback | paleta própria: verde Atenna + 1 neutro quente; gradiente mais sutil ou cor chapada + 1 acento |
| **Emoji em headings** (🛡️ 🎉 ✉️) | welcome, popup, e-mails | trocar por ícone SVG do sistema ou nada |
| **3 bullets com emoji-ícone** no rodapé do painel | welcome | 1 prova social ou 1 frase de valor, não lista |
| **"Bem-vindo!" + subtítulo** genérico | welcome, popup login | headline específica ("Seus dados nunca vão pra IA" já é boa — usar ELA) |
| **Popup dark** (`#1a1a1a`/`#000`) vs **welcome light** | popup vs welcome | um sistema só: tokens compartilhados (`admin/src/styles` + popup + modal + welcome) |
| Botão verde com **texto preto** (`color:#000`) | popup | contraste/أcessibilidade — texto branco ou verde-escuro |
| Inline `style=` por todo lado (centenas) | popup.ts, welcome.html | classes + tokens; o Impeccable não consegue iterar em inline |

---

## Parte 3 — Plano (por superfície, dirigido pelo `impeccable`)

Um **design system único** (`_tokens.css`): cor, tipo, espaço, raio, sombra, motion.
Aplicado nesta ordem:

1. **`welcome.html` + `auth/callback`** (login/signup/reset) — primeira impressão. Tira emoji,
   paleta própria, headline forte, 1 ideia no painel, preview do badge.
2. **`popup`** (`popup.ts` + `popup.css`) — reescrever com classes/tokens (fim do inline),
   mesma identidade do welcome, tema claro. `renderLogin`/`renderHome`/`renderOnboarding`.
3. **Modal in-page** (`src/ui/modal/*` + `modal.css`) — já tem identidade; alinhar aos tokens,
   tirar emoji, revisar skeleton/estados.
4. **Admin `/nexussafe/`** (`admin/src/styles`) — já tem base; passar o Impeccable p/ hierarquia,
   densidade, dark/light consistente.
5. **E-mails transacionais** (`backend/routes/email_service.py::_base`) — alinhar ao sistema.

Cada superfície: `impeccable` audita → comp aprovado → build → `impeccable-finish-reviewer` →
screenshot/validação no navegador (Playwright MCP) → PR.

### Não-objetivos
- Não trocar o split-panel do login (funciona) — dar caráter a ele.
- Não redesenhar o modal do zero (tem identidade) — alinhar.

---

## Testes / validação

- `src/__tests__/popup-auth-flow.test.ts` (bug) — verde.
- Onboarding e2e (Playwright): instala → welcome → signup → **cai logado** → abre ChatGPT →
  badge aparece. (hoje: T1–T8 + W1–W15; adicionar `O1` signup-auto-login.)
- Cada tela redesenhada: screenshot antes/depois no PR + `impeccable-finish-reviewer` sem
  achado material.
- Contraste AA em todos os textos/botões (o Impeccable checa).
