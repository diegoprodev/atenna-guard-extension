# FASE B14 — onboarding enterprise (welcome "como funciona" + coach mark in-page)

**Status:** spec · aprovado pelo dono 2026-09-09 (opção C, sem emoji, padrão enterprise)
**Design:** dirigido pelo `impeccable` (`onboard`), sobre o design system existente (`tokens.css`, `welcome.css`).

## Problema

Depois de instalar + criar conta, o usuário não vê **nenhum** onboarding que ensine a usar.
A tela de sucesso da welcome só dizia "abra uma plataforma, o botão aparece". Nada explica:
- que o botão fica ancorado no campo de mensagem
- que a varinha reescreve o texto em 3 versões (o "aha")
- que o escudo detecta CPF/e-mail/telefone/cartão antes do envio
- o limite de 5/dia no free

O dono: *"como o user vai saber usar? isso é péssimo."*

## Decisão

**Opção C** — os dois, enxuto:
1. **welcome.html `#w-success`** vira uma tela de ativação com 3 conceitos + limite + links.
2. **1 coach mark in-page** ancorado no badge, na 1ª vez que ele aparece por perfil.

Princípios (do `impeccable onboard`): tempo até o valor, contexto sobre cerimônia, mostrar
não contar, respeitar a inteligência do usuário, nunca repetir. **Sem emoji, sem números de
seção, sem cards genéricos** — ícones desenhados, tipografia do design system.

| Tema | Decisão |
|---|---|
| welcome: forma | 3 linhas-conceito (label forte + 1 linha), não cards; entre 2 fios de 1px; fade-in escalonado |
| welcome: motivo visual | a tarja de censura (`--redact`) na frase "dados sensíveis" — amarra ao herói |
| coach mark: forma | card escuro auto-contido (tinta `--ink`), lê em página clara ou escura sem depender do tema do site (padrão Linear/Vercel) |
| coach mark: gatilho | ~1s depois do badge REAL ancorar, uma vez por perfil (`atenna_coachmark_seen` local + `POST /auth/mark-onboarding-seen` best-effort) |
| coach mark: dispensa | "Entendi", clique fora, ou 12s sozinho |
| coach mark: posição | à esquerda do badge, centrado nele; fallback por cima se não couber |

## Arquivos

| Arquivo | Mudança |
|---|---|
| `welcome.html` | `#w-success` reescrito (`.w-activate`/`.w-steps`/`.w-step`/`.w-quota`) + CSS |
| `src/welcome/welcome.ts` | `showSuccess` esconde `#w-form-header`, popula `#w-success-sub` com o e-mail; `switchTab` restaura o header |
| `src/content/coachmark.ts` | **novo** — `maybeShowCoachmark(badge)`, dependency-free, CSS inline, PII-safe |
| `src/content/content.ts` | chama `maybeShowCoachmark` ~1s após `injectButton` (flag `_coachmarkTried` por página) |
| `src/content/injectButton.ts` | `getLogoUrl` exportado (usado pelo coach mark) |
| `src/background/background.ts` | handler `MARK_ONBOARDING_SEEN` → `POST /auth/mark-onboarding-seen` |
| backend | endpoint `POST /auth/mark-onboarding-seen` **já existia** (`bff_auth.py`) — só passou a ser chamado |

## Contrato

- Pós-login (e-mail ou Google): tela "Tudo pronto" com 3 conceitos + "Cinco gerações por dia
  no plano grátis" + 4 links de plataforma. Sem duplicar título com o header do form.
- Voltar pro login (`switchTab`) restaura o form normal.
- 1ª vez que o badge real aparece numa plataforma: coach mark após ~1s. Some no "Entendi" /
  clique fora / 12s. Marca visto local + servidor. **Nunca reaparece.**
- Usuário existente que atualiza pra 2.3.0: vê o coach mark uma vez (é informativo, 1 toque
  dispensa) — aceitável.

## Harness

- **E2E F16 (novo)** — coach mark: 1ª visita mostra + "Entendi" fecha + grava `atenna_coachmark_seen` + 2ª visita não volta.
- **E2E W8 (atualizado)** — tela de sucesso: `#w-success-title` = "Tudo pronto", `#w-success-sub` com e-mail, `#w-form-header` escondido, 3 `.w-step` (badge/versões/dados sensíveis), `.w-quota` com "Cinco gerações por dia", 4 links.
- **E2E W7 / W13 (atualizados)** — asserção de sucesso migrada pra `#w-success-title`.
- vitest — sem regressão (353/354, 1 skip).
- Screenshots (welcome desktop + narrow + painel; coach mark full + crop) — validados pelo dono.

## 3 chapéus

- **Arquiteto:** `coachmark.ts` é dependency-free, PII-safe (não lê nem loga conteúdo do input),
  CSS inline (não depende de `styles.css` no timing). Flag local é a fonte da verdade; o servidor
  é best-effort. `MARK_ONBOARDING_SEEN` passa pelo guard `sender.id`.
- **PO:** ensina os 3 conceitos que destravam o valor (varinha = aha; escudo = promessa;
  onde fica). Não é wizard bloqueante. Fricção do free preservada (o limite é ensinado, não afrouxado).
- **Estrategista:** onboarding bom é fator de ranking na CWS. Ensina a extensão, não a Plataforma —
  nada de governança/multi-tenant aqui.

## Riscos

| Risco | Mitigação |
|---|---|
| coach mark quebra layout de página de terceiro | `position:fixed`, z-index abaixo do badge, sem tocar no DOM do site; some sozinho |
| card escuro ilegível em página clara | é auto-contido (tinta própria + texto claro), padrão consagrado (Linear) |
| usuário existente vê o coach mark 1x | aceitável — informativo, 1 toque dispensa |
| welcome muito alto → scroll | `.w-right` já tem `overflow-y:auto`; testado em 480px |

## Rollout

1. Build + `npm run test:e2e` + screenshots — feito.
2. CHANGELOG + commit + PR + merge.
3. Entra no mesmo zip 2.3.0 (nada publicado ainda).
