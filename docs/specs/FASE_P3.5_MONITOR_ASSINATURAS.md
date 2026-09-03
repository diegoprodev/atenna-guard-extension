# FASE P3.5 — Monitor de assinaturas (proteção de receita)

**Status:** em implementação · **Parte de:** P3 · **Relacionado:** `checkout-audit-spec.md` BUG-01

## Problema

O plano do usuário vive em **3 tabelas**, escritas em pontos diferentes e **não atomicamente**:

| Tabela | Colunas de plano | Quem lê |
|---|---|---|
| `profiles` | `plan`, `plan_type`, `plan_expires_at` | fallback do `get_user_plan`, admin |
| `user_plans` | `plan_type`, `status` | **fonte primária** de `dlp/rate_limit.get_user_plan` |
| `subscriptions` | `plan`, `status`, `valid_until` | pouco usada hoje (está vazia) |

`_promote_to_pro` / `_downgrade_to_free` (checkout.py) escrevem nas 3 em sequência com `try/except`
por tabela → se uma falha, as outras já mudaram → **drift**. BUG-01: usuário paga, `user_plans`
vira pro, `profiles` não → se a query de `user_plans` falhar, o `get_user_plan` cai no `profiles`
e **bloqueia um usuário pago**.

**Drift já presente hoje** (3 usuários): `profiles.plan=free` mas `user_plans.status=active/pro`.

## Decisões

| Tema | Decisão | Porquê |
|---|---|---|
| Monitor | job diário `subscription_health_check` no scheduler + `observability.monitor` check-in | alerta no Discord se não rodar |
| O que checa | (a) drift `profiles` ↔ `user_plans`; (b) `plan='pro'` sem `plan_expires_at`; (c) pro vencido ainda ativo; (d) webhook Asaas sem evento > 48h | os 4 modos de falha reais |
| Alerta | `logger.error` (vira issue no GlitchTip → Discord) com a lista de user_ids afetados (sem email cru — hash/prefixo) | zero-trust: não vazar PII no painel |
| Métricas Prometheus | `atenna_subscriptions_total{plan,status}`, `atenna_subscription_sync_mismatch` (gauge), `atenna_last_checkout_event_age_seconds` (gauge) | painel + alerta de degradação |
| Reconciliação do drift atual | script `scripts/reconcile_plans.py` (one-shot, idempotente): fonte da verdade = `user_plans` (mais atual); sincroniza `profiles` e `subscriptions` | limpar o que já está torto |
| Fix da causa raiz (escrita atômica) | **follow-up FASE 9.4** — mexer no `_promote_to_pro` exige cuidado (código de pagamento) + teste de bypass | fora do escopo deste monitor |

## Arquivos

```
backend/routes/subscription_health.py   # novo — check + reconcile helpers
backend/main.py                          # + job no scheduler (observability.monitor)
backend/observability_metrics.py         # + as 3 métricas
backend/scripts/reconcile_plans.py       # one-shot p/ o drift atual
backend/tests/test_subscription_health.py # drift detectado; pro sem expiry; vencido ativo
```

## Testes

1. Semear `profiles.plan=free` + `user_plans.status=active` p/ um user fake → `check()` retorna
   1 mismatch, métrica `atenna_subscription_sync_mismatch` = 1.
2. `plan='pro'` + `plan_expires_at=NULL` → flag "pro sem expiry".
3. `plan='pro'` + `plan_expires_at` no passado + ainda `active` → flag "vencido ativo".
4. `reconcile_plans.py` num estado torto → depois as 3 tabelas concordam; rodar 2× = no-op.
5. Nenhum email cru no output do `logger.error` (só `user_id[:8]`).

## Rollout

Monitor + métricas → deploy → rodar `check()` à mão (ver o drift real) → `reconcile_plans.py`
→ confirmar 0 mismatch → job no cron → GlitchTip monitor → CHANGELOG → PR.
