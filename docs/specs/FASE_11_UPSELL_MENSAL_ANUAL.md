# FASE 11 — Upsell mensal → anual + cupom de retenção automático

**Status:** planejado · **Bloqueia:** nada · **Precede:** revisão de billing (P8 Stripe)
**Sensível:** mexe em cobrança — todo valor de desconto é decidido e validado **server-side**.

---

## Problema

Hoje a lógica de plano no cliente só conhece `free` vs `pro`. Consequências:

1. Um usuário **Pro mensal** (R$29,90/mês) não recebe nenhum incentivo para migrar ao
   **anual** (R$197/ano ≈ R$16,42/mês, −45%) — dinheiro na mesa e churn mensal maior.
2. `planManager.syncPlanFromBff` **cravado em `planType: 'monthly'`** para todo Pro —
   o cliente não sabe o ciclo real de cobrança.
3. Não existe cupom de retenção: quando o mensal cogita cancelar, não há oferta.

O que **não** é problema (manter como está):
- Free → vê o upsell completo do produto (FASE 10.8 já garante que **Pro não vê**).
- Pro anual → topo da esteira, **não vê nada** de upsell.

---

## Decisões

| Tema | Decisão | Porquê |
|---|---|---|
| Fonte do ciclo | `/auth/me` passa a devolver `plan_cycle: "monthly" \| "yearly" \| null` | o cliente precisa saber; hoje deriva errado |
| Origem do dado | `subscriptions.billing_cycle` (ou `provider_subscription` do provedor) — **não** `user_plans` | `user_plans` só tem `plan_type` (free/pro); o ciclo vive na assinatura |
| `planManager` | `Plan.planType` passa a vir de `me.plan_cycle` (fallback `'monthly'` se ausente, p/ compat) | remove o valor cravado |
| Onde o upsell anual aparece | **card discreto** no rodapé do painel Refinar e na tela de Configurações — **só p/ `pro + monthly`**. Copy de economia, não de "vire Pro" | Pro já é Pro; a mensagem é diferente (Lei de Jakob — não repetir CTA de conversão) |
| Cupom automático | código de retenção **gerado e validado no backend** (`POST /checkout/retention-offer` → devolve `{coupon_code, discount_pct, expires_at}`); o cliente só **exibe** e repassa no checkout | zero-trust: cliente nunca decide o desconto |
| Provedor | Asaas: `discount` no `payment`/`subscription`. Stripe: `coupon`/`promotion_code`. O backend cria/reusa um cupom fixo (`ANUAL_RETENCAO_20`) por provedor | não inventar cupom por request |
| Elegibilidade do cupom | server-side: só `plan=pro` + `cycle=monthly` + assinatura ativa há ≥ 1 ciclo + sem cupom de retenção usado nos últimos 12 meses | evita abuso; auditável |
| Anti-abuso | rate-limit por `user_id` no `/checkout/retention-offer`; log em `checkout_events` com `event_type='retention_offer_shown'` | rastreável |
| Fricção proposital | o card anual **não** é intrusivo (sem overlay, sem interrupção) — é uma oferta, não um bloqueio | posicionamento: extensão = isca, upsell suave |

---

## Arquivos

```
backend/routes/bff_auth.py                 # /auth/me: + plan_cycle (lê de subscriptions)
backend/routes/checkout.py                 # + POST /checkout/retention-offer (gera/valida cupom)
backend/services/coupon_service.py         # (novo) cria/reusa cupom no provedor, checa elegibilidade
backend/db/migrations/xxxx_retention.sql   # subscriptions.billing_cycle (se faltar) + retention_offers
backend/tests/test_retention_offer.py      # (novo) elegibilidade, rate-limit, valor server-side
src/core/planManager.ts                    # planType vem de me.plan_cycle
src/auth/bffClient.ts                      # MeResponse + plan_cycle
src/ui/modal/plans-modal.ts                # renderAnnualUpsellCard(offer) — card discreto
src/ui/modal/core.ts                       # mostra o card só p/ pro+monthly (no Refinar)
src/ui/modal/settings.ts                   # idem, na seção de plano
src/ui/modal/network.ts                    # fetchRetentionOffer()
tests/e2e/full-flow.spec.ts                # F8 (monthly vê card anual), F9 (yearly não vê nada)
tests/e2e/*-api.spec.ts                    # bate no /checkout/retention-offer real (staging)
docs/specs/FASE_11_UPSELL_MENSAL_ANUAL.md   # este
CHANGELOG.md
```

---

## Contrato

**`GET /auth/me`** (adiciona campo):
```json
{ "user_id": "...", "email": "...", "plan": "pro", "expires_at": 1234567890,
  "plan_cycle": "monthly", "onboarding_seen": true }
```
`plan_cycle` ∈ `"monthly" | "yearly" | null` (null = free ou ciclo desconhecido).

**`POST /checkout/retention-offer`** (auth: token opaco):
- 200 `{ "eligible": true, "coupon_code": "ANUAL_RETENCAO_20", "discount_pct": 20, "price_after": "157,60", "expires_at": 1234567890 }`
- 200 `{ "eligible": false, "reason": "not_monthly" | "recent_offer" | "not_active" }`
- 429 rate-limit

**Cliente:** `renderAnnualUpsellCard` só é chamado quando `me.plan === 'pro' && me.plan_cycle === 'monthly'`.
O preço/desconto exibido vem **exclusivamente** da resposta do backend. No checkout,
`openCheckout('retention_annual', btn, 'yearly')` passa o `coupon_code` recebido; o backend
**revalida** elegibilidade + aplica o cupom do provedor (nunca confia no valor do cliente).

---

## Riscos

| Risco | Mitigação |
|---|---|
| Cliente forja `plan_cycle` p/ ver oferta | inócuo — o card só mostra copy; o desconto real é revalidado no `/checkout/create` server-side (teste de bypass) |
| Cliente replaya `coupon_code` sem elegibilidade | `/checkout/create` chama `coupon_service.assert_eligible(user_id)` antes de aplicar; 403 se não |
| Cupom aplicado a quem não deveria (ex.: já anual) | elegibilidade server-side: `cycle=monthly` obrigatório |
| Abuso: pedir oferta repetidamente | rate-limit + `retention_offers` grava 1 por usuário/12 meses |
| `subscriptions.billing_cycle` não existe / está sujo | migração + fallback: se null, trata como `monthly` só p/ exibição, mas o `/checkout` valida contra o provedor |
| Divergência Asaas vs Stripe no formato de cupom | `coupon_service` isola o provedor (mesma interface `get_or_create_retention_coupon(provider)`) |
| Mostrar oferta e o preço mudar → usuário se sente enganado | `expires_at` na oferta (24–72h); o checkout mostra o valor final antes de confirmar |

---

## Rollout

1. Migração `subscriptions.billing_cycle` + tabela `retention_offers`.
2. `coupon_service` + cupom fixo criado nos 2 dashboards (Asaas + Stripe) — manual, documentado.
3. `/auth/me` com `plan_cycle` (compatível: cliente antigo ignora o campo).
4. `/checkout/retention-offer` atrás de feature flag `RETENTION_OFFER_ENABLED` (off → sempre `eligible:false`).
5. Cliente: card anual (só aparece se o backend disser `eligible:true`).
6. Ligar a flag em shadow (loga `retention_offer_shown`, card oculto) por 1 semana → medir.
7. Ligar de verdade. Medir conversão mensal→anual e churn.

---

## Testes / validação

- **Backend (`pytest`):** elegibilidade (monthly/yearly/free), rate-limit, `assert_eligible` no
  `/checkout/create`, valor do desconto vem da config (não do request), 1 oferta/12 meses.
- **Bypass (`tests/security/`):** `plan_cycle` forjado → card aparece mas `/checkout/create`
  com `coupon_code` e usuário não-elegível → **403**; desconto adulterado no body → ignorado.
- **E2E extensão (`--project=extension`):** F8 (pro+monthly vê o card anual, free não vê,
  pro+yearly não vê nada), F9 (clicar no card → checkout com o cupom certo — mock).
- **E2E api (`--project=welcome-real` / `api`):** `/auth/me` real devolve `plan_cycle`;
  `/checkout/retention-offer` real responde elegibilidade coerente.
- **Contrato:** JSON Schema do `MeResponse` + `RetentionOffer` (Pydantic → `ajv` no front).
- `npm run test:e2e` reportando o número real. `vitest` sem regressão.

---

## Skills / plugins (roteiro enterprise — `docs/TOOLING_ENTERPRISE.md`)

| Skill / camada | Onde entra |
|---|---|
| **`impeccable`** | design do card de upsell anual — discreto, na identidade, sem repetir o CTA de conversão. `impeccable-finish-reviewer` antes do PR |
| **Playwright** (`--project=extension` + `api`) | E2E F8/F9 com a extensão carregada; api contra o backend real de staging |
| **TestSprite** (MCP) | cobertura de fluxo: monthly → vê card → checkout anual → cupom aplicado |
| **`/code-review`** | diff da branch (billing = área de risco) |
| **`spec-to-code-compliance`** (Trail of Bits) | valida cada linha desta spec contra o PR |
| **`differential-review`** (Trail of Bits) | 5ª camada — toda mudança de billing passa aqui |
| **`agentic-actions-auditor`** (Trail of Bits) | audita mudanças em `checkout.py` / webhooks / `deploy.yml` (segredos, injeção via input) |
| **`property-based-testing`** (Trail of Bits) | `coupon_service`: geração/validação de código, math de desconto (`Hypothesis`) |
| **`supply-chain-risk-auditor`** (Trail of Bits) | se entrar SDK novo do provedor (Stripe coupons) |
| **`claude-mem`** | registrar as decisões de billing entre sessões |

Cada camada que apontar problema **bloqueia** o "pronto" até resolver (REGRA CANÔNICA do `CLAUDE.md`).

---

## Não-objetivos

- Não construir um motor de cupons genérico — 1 cupom de retenção fixo por provedor.
- Não fazer downgrade/upgrade de ciclo dentro da extensão — o checkout do provedor cuida.
- Não implementar dunning / recuperação de pagamento (isso é P8 / Plataforma).
- Não mexer no upsell **free → pro** (já está certo depois da FASE 10.8).
