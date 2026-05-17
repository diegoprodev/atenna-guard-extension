# Checkout Audit Spec — Atenna Pro

## Tabelas envolvidas

| Tabela | Propósito | Fonte de verdade para |
|---|---|---|
| `profiles` | Perfil do usuário | Plano (extensão lê aqui) |
| `user_plans` | Plano legado/admin | Rate limiting do backend (`rate_limit.py` lê aqui) |
| `subscriptions` | Registro de assinatura | Histórico de assinaturas Asaas |
| `checkout_events` | Funil de conversão | Rastreio de leads/abandonos |
| `dlp_events` | Audit log LGPD | Toda atividade de plano |

---

## Fluxo completo com checklist por etapa

### ETAPA 1 — Usuário clica "Upgrade" (POST /checkout/create)

| Coluna | Tabela | Status | Observação |
|---|---|---|---|
| `asaas_customer_id` | `profiles` | ✅ Escrito | |
| `asaas_subscription_id` | `profiles` | ✅ Escrito | |
| `checkout_events` (event=initiated) | `checkout_events` | ❌ AUSENTE | Lead não registrado para subscriptions |
| `subscriptions` (status=pending) | `subscriptions` | ❌ AUSENTE | Tabela nunca escrita |

### ETAPA 2 — Usuário paga (Webhook: PAYMENT_RECEIVED / PAYMENT_CONFIRMED)

| Coluna | Tabela | Status | Observação |
|---|---|---|---|
| `plan` = 'pro' | `profiles` | ✅ Escrito | |
| `plan_type` = 'monthly'\|'yearly' | `profiles` | ✅ Escrito | |
| `plan_expires_at` | `profiles` | ✅ Escrito | |
| `updated_at` | `profiles` | ✅ Escrito | |
| `dlp_events` audit log | `dlp_events` | ✅ Escrito | |
| `plan_type` = 'pro' | `user_plans` | ❌ CRÍTICO | rate_limit.py lê DESTA tabela → usuário paga mas backend ainda bloqueia como free |
| `status`, `billing_period` | `user_plans` | ❌ AUSENTE | Colunas não existem ainda |
| `subscriptions` (status=active) | `subscriptions` | ❌ AUSENTE | Tabela nunca escrita |
| `checkout_events` (event=paid) | `checkout_events` | ❌ AUSENTE | Funil incompleto para subscriptions |

### ETAPA 3 — Renovação automática (Webhook: PAYMENT_RECEIVED novamente)

| Coluna | Tabela | Status | Observação |
|---|---|---|---|
| `plan_expires_at` (nova data) | `profiles` | ✅ Atualizado | |
| `dlp_events` audit log | `dlp_events` | ✅ Escrito | |
| `user_plans` atualizado | `user_plans` | ❌ AUSENTE | Nunca sincronizado |
| `subscriptions.valid_until` | `subscriptions` | ❌ AUSENTE | |

### ETAPA 4 — Pagamento vencido (Webhook: PAYMENT_OVERDUE)

| Coluna | Tabela | Status | Observação |
|---|---|---|---|
| `dlp_events` log | `dlp_events` | ✅ Escrito | |
| `user_plans.status` = 'past_due' | `user_plans` | ❌ AUSENTE | Admin não vê inadimplência |
| `profiles.plan` mantido (grace) | `profiles` | ✅ Intencional | Grace period correto |

### ETAPA 5 — Cancelamento (Webhook: SUBSCRIPTION_CANCELLED)

| Coluna | Tabela | Status | Observação |
|---|---|---|---|
| `plan` = 'free' | `profiles` | ✅ Escrito | |
| `plan_type` = 'free' | `profiles` | ✅ Escrito | |
| `plan_expires_at` = NULL | `profiles` | ✅ Escrito | |
| `user_plans.plan_type` = 'free' | `user_plans` | ❌ AUSENTE | rate_limit não reflete |
| `subscriptions.status` = 'cancelled' | `subscriptions` | ❌ AUSENTE | |

---

## Bugs críticos identificados

### BUG-01 🔴 CRÍTICO — rate_limit.py lê `user_plans`, webhook escreve em `profiles`
`rate_limit.py::get_user_plan()` consulta `user_plans.plan_type`.
O webhook `_promote_to_pro()` só atualiza `profiles`.
**Resultado**: usuário paga, extensão mostra Pro, mas backend ainda bloqueia como Free.

### BUG-02 🟠 ALTO — `subscriptions` table nunca populada
Tabela existe no banco mas nunca é escrita. Sem rastreio de assinaturas ativas.

### BUG-03 🟠 ALTO — `checkout_events` sem registro para subscriptions
Funil de conversão incompleto. Apenas o fluxo legado (CHECKOUT_*) registra.

### BUG-04 🟡 MÉDIO — `user_plans` sem colunas `status` e `billing_period`
Admin consegue ver e alterar plano, mas sem contexto de status e ciclo.

### BUG-05 🟡 MÉDIO — Webhook events não tratados
`SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`, `PAYMENT_REFUNDED` não têm handler.

---

## Correções a implementar

1. `_promote_to_pro` → também escrever `user_plans` e `subscriptions`
2. `_downgrade_to_free` → também atualizar `user_plans` e `subscriptions`  
3. `PAYMENT_OVERDUE` → marcar `user_plans.status = 'past_due'`
4. `create_checkout` → registrar `checkout_events` com `event_type=initiated`
5. Migração: adicionar `status`, `billing_period` em `user_plans`
6. `rate_limit.py` → fallback para `profiles` se `user_plans` vazio
