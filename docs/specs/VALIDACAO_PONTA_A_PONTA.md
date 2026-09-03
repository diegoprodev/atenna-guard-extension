# Validação ponta a ponta — a experiência completa do usuário

**Objetivo:** um roteiro único que exercita **toda** a extensão como um usuário real faria —
instalar, logar, usar, pagar, sair — pegando bug silencioso, erro de console, botão morto,
latência ruim e regressão de UX **antes** de publicar.

**Regra (CLAUDE.md):** render/screenshot não valida. Tudo aqui carrega o `dist/` real no
Chromium (`playwright --project=extension`). O que não dá pra automatizar está marcado
**[manual]** com o porquê.

---

## Como rodar

```
npm run test:e2e                    # build + localhost + suíte extension inteira
npx playwright test tests/e2e/validation-full.spec.ts --project=extension   # só este roteiro
npx playwright test --project=api                                            # backend real
```

O `validation-full.spec.ts` **falha se aparecer qualquer erro de console `[Atenna]`** durante
qualquer passo — é o detector de bug silencioso.

---

## Matriz — o que é validado

### 1. Instalação / primeira impressão
| # | Cenário | Como | Automatizado |
|---|---|---|---|
| V1.1 | extensão carrega, service worker registra | `extensionId` bate `^[a-z]{32}$` | ✅ T1/T2 |
| V1.2 | ID é o fixo (`"key"` no manifest) | id === `eeejlbiagiieioangpmhhfjlnpphljao` | ✅ VF |
| V1.3 | welcome abre no `install` | tab nova com `welcome.html` | **[manual]** — precisa scriptar o evento install; coberto em parte por VF (flag) |

### 2. Welcome (login / signup / reset)
| # | Cenário | Automatizado |
|---|---|---|
| V2.1 | estrutura, logo, tabs, marcas das plataformas | ✅ W1/W2 |
| V2.2 | troca de aba login↔signup↔forgot | ✅ W3 |
| V2.3 | validação de campo vazio (login, signup, forgot) | ✅ W4/W5 |
| V2.4 | olho mostra/oculta senha (muda `type`) | ✅ W6 + VF (assert type) |
| V2.5 | login OK → tela de sucesso com links de plataforma | ✅ W8 |
| V2.6 | login senha errada → erro amigável | ✅ W9 |
| V2.7 | signup OK → **cai logado direto** (auto-login) | ✅ W7 |
| V2.8 | signup com auto-login falhando → fallback manual | ✅ W7b |
| V2.9 | signup email já usado → erro amigável | ✅ W12 |
| V2.10 | forgot → form, esconde tabs, envia, mostra info | ✅ W10 |
| V2.11 | Enter nos campos de login submete | ✅ W13 |
| V2.12 | "Criar conta grátis" / "Entrar" dentro do form trocam de aba | ✅ W14/W15 |
| V2.13 | botão Google: estado inicial + loading no clique | ✅ W11 |
| V2.14 | **login Google real** (redirect → picker → sessão) | **[manual]** — OAuth externo. Precisa o redirect `chromiumapp.org` na allowlist do Supabase. Timeout de 120s cobre o caminho de erro |
| V2.15 | reset de senha real (email + token) | **[manual]** — depende de email real / Supabase |

### 3. Popup (ícone da extensão)
| # | Cenário | Automatizado |
|---|---|---|
| V3.1 | deslogado → login **com mensagem de valor**, **não some** | ✅ P1 |
| V3.2 | logado → home (email, plano, "Abrir Atenna") | ✅ P2 |
| V3.3 | signup no popup troca a mensagem | ✅ P3 |
| V3.4 | 1º-run logado → onboarding (4 plataformas) | ✅ popup.test |
| V3.5 | logout do popup → volta pro login | ✅ VF |

### 4. Página da IA — badge + DLP
| # | Cenário | Automatizado |
|---|---|---|
| V4.1 | deslogado → **nada** na página (decisão do dono) | ✅ T3 |
| V4.2 | logado → badge aparece acima do input | ✅ T4 |
| V4.3 | digitar CPF → banner de proteção | ✅ T5/T7 |
| V4.4 | "Proteger dados" mascara o CPF (textarea + React) | ✅ T8 |
| V4.5 | clicar no badge → modal abre | ✅ T6 |
| V4.6 | logout em outra aba → badge some | ✅ F5 |

### 5. Modal in-page (Refinar)
| # | Cenário | Automatizado |
|---|---|---|
| V5.1 | abre **direto no Refinar** — **sem wizard** de onboarding | ✅ F3 |
| V5.2 | digitar + Refinar → **3 cards** (Direto/Estruturado/Estratégico) | ✅ F4 |
| V5.3 | aba Histórico existe e alterna | ✅ VF |
| V5.4 | **PRO não vê upsell** nenhum | ✅ F6 |
| V5.5 | FREE vê o upsell (contraprova) | ✅ F7 |
| V5.6 | fechar com ESC / clicar fora | ✅ T6 + VF |
| V5.7 | modal usa a identidade Atenna (verde-pinho, serif) — sem cinza genérico | **[visual]** screenshot no PR |

### 6. Configurações
| # | Cenário | Automatizado |
|---|---|---|
| V6.1 | abre pela engrenagem do badge, mostra o email logado | ✅ F5 |
| V6.2 | seções: Uso de prompts, LGPD, Personalização, Privacidade | ✅ VF |
| V6.3 | **"Seus dados" / "Exclusão de conta" têm botão clicável** | ✅ VF |
| V6.4 | "Sair" pede **confirmação** antes | ✅ VF (dialog handler) |
| V6.5 | FREE vê cards de preço na seção de uso; PRO não | ✅ VF |

### 7. Planos / checkout
| # | Cenário | Automatizado |
|---|---|---|
| V7.1 | modal de planos abre, header "Atenna Safe Prompt" (não "Guardião") | ✅ VF |
| V7.2 | 2 cards (mensal / anual), anual destacado | ✅ VF |
| V7.3 | clicar num plano → `openCheckout` com o plano certo | ✅ VF (intercepta a chamada) |
| V7.4 | **checkout real** (Asaas PIX / cartão) | **[manual]** — provedor externo, contas de teste |
| V7.5 | pagamento → `bffMe` vira `pro` → upsell some | **[manual/api]** — webhook do provedor |

### 8. Latência (orçamento)
| # | Medida | Orçamento | Automatizado |
|---|---|---|---|
| V8.1 | badge injeta após sessão | < 3 s | ✅ VF |
| V8.2 | modal abre (clique no badge → tabs visíveis) | < 2,5 s | ✅ VF |
| V8.3 | Refinar → 3 cards (mock) | < 4 s | ✅ VF |
| V8.4 | popup renderiza login (deslogado) | < 1,5 s | ✅ VF |
| V8.5 | `/generate-prompts` real p95 | < 8 s | **[api]** k6 (FASE P3.7b) |

### 9. Bug silencioso / robustez
| # | Cenário | Automatizado |
|---|---|---|
| V9.1 | **nenhum** `console.error('[Atenna]…')` em qualquer fluxo | ✅ VF (falha o teste) |
| V9.2 | nenhuma promessa rejeitada sem tratamento | ✅ VF (pageerror) |
| V9.3 | badge não injeta 2x / não duplica listeners em SPA nav | ✅ T4 + VF |
| V9.4 | modal não abre 2x (toggle) | ✅ VF |
| V9.5 | sem `chrome.runtime.lastError` não tratado | **[manual]** — inspeção do SW |

---

## O que só dá pra validar à mão (e por quê)

| Item | Por quê | Como testar |
|---|---|---|
| **Login Google real** | `chrome.identity.launchWebAuthFlow` + OAuth do Google + redirect registrado no Supabase | remover+re-adicionar a extensão (ID `eeejlbiagiieioangpmhhfjlnpphljao`) → clicar "Entrar com Google" → escolher conta → volta logado |
| **Reset de senha real** | email transacional + token do Supabase | pedir reset → abrir o email → clicar no link → nova senha → logar |
| **Checkout real** | Asaas / Stripe, contas de teste, webhooks | rodar em staging (FASE P3.6) com conta de teste do provedor |
| **welcome abre no install** | precisa scriptar o evento `chrome.runtime.onInstalled` | remover+re-adicionar → a aba de boas-vindas abre |
| **Aparência (verde-pinho, serif, sem "cara de IA")** | julgamento visual | screenshot antes/depois no PR + `impeccable-finish-reviewer` |

---

## TestSprite (roteiro enterprise — camada 3)

O MCP `testsprite` gera/roda testes de fluxo end-to-end e reporta cobertura de caminho
crítico. Roda **depois** do Playwright, **antes** do code review.

**Estado:** o servidor MCP `testsprite` não está conectando nesta máquina
(`CONNECTION_CLOSED`). Enquanto não conecta:
- rodar o `validation-full.spec.ts` como o gate de fluxo
- quando conectar: apontar o TestSprite para os 8 fluxos da matriz acima e comparar cobertura

---

## Checklist de "pronto pra publicar"

- [ ] `npm run test:e2e` → todos verdes, número reportado
- [ ] `npx playwright test validation-full.spec.ts` → verde, **0 erro de console `[Atenna]`**
- [ ] `vitest run` → 0 falha
- [ ] `pytest backend/` no container → 0 falha
- [ ] login Google **[manual]** OK na extensão sem compactação
- [ ] reset de senha **[manual]** OK
- [ ] checkout **[manual/staging]** OK (PIX + cartão)
- [ ] screenshot de cada tela no PR + `impeccable-finish-reviewer` sem achado material
- [ ] `/code-review` no diff + `differential-review` (billing = risco)
- [ ] `sync-version --check` ok, `CHANGELOG.md` atualizado
- [ ] smoke manual: 5 plataformas (ChatGPT/Claude/Gemini/Perplexity), badge + input detectado
