# FASE 10.9.6 — LGPD funcional + fim dos erros silenciosos

**Status:** frontend feito; **migração do banco pendente** (dono roda ou libera).
**Origem:** o dono clicou "Solicitar relatório" / "Excluir dados" e **nada acontecia**.

## Diagnóstico (via observabilidade — não às cegas)

Logs do backend na VPS (`docker compose logs backend`, alimenta o GlitchTip):

```
POST /user/export/request   → 503   'User already has an active export request' (P0001)
POST /user/deletion/initiate → 503   'Could not find the function
                                      public.initiate_account_deletion(...)' (PGRST202)
Error getting export status: 'column reference "status" is ambiguous' (42702)
```

O banco de produção (`kezbssjmgwtrunqeoyir`) tem:

| Objeto | Estado |
|--------|--------|
| `initiate_export_request`, `confirm_export_request`, … | ✅ existem |
| `get_export_status` | ⚠️ **bug**: coluna OUT `status` colide com `user_export_requests.status` → 42702 em toda chamada |
| `user_export_requests` | ✅ existe — mas o dono tem **2 pedidos presos em `requested`** (mai/2026 e hoje 02:16), e `initiate_export_request` recusa um novo (`P0001`) |
| `user_deletion_requests` + `initiate_account_deletion` + … | ❌ **não existem** — a migration `20260507_account_deletion_governance.sql` nunca foi aplicada neste banco (mesma vítima da migração de infra de set/2026 que sumiu com `/auth/admin-login`) |

E o frontend (`privacy-data.ts`): **todo erro caía só no `console.error`** — o usuário
clicava e não via nada. Viola a regra "jamais um erro só pro console".

## Como funciona o fluxo (resposta às perguntas do dono)

### Relatório de dados (LGPD Art. 18 — acesso/portabilidade)
1. Usuário clica "Solicitar relatório" → backend registra o pedido + gera token
2. E-mail de confirmação (link, válido 24h) — não gera nada ainda
3. Usuário clica no link → PDF é montado em background
4. E-mail com link de download → **máx. 3 downloads em 48h**, depois expira e é purgado

### Exclusão de conta (LGPD Art. 18 VI — eliminação)
`pending_confirmation` → (e-mail) → `deletion_scheduled` (**graça de 7 dias**, cancelável)
→ `purging` → `purged` (PII apagada) → `anonymized` (logs sem PII mantidos p/ auditoria)

### Soft ou completo? — **os dois, nessa ordem**
A LGPD exige **eliminação real** do dado pessoal quando o titular pede (Art. 16 / 18 VI).
Permite reter só o mínimo: obrigação legal, exercício de direito em processo, ou dado
**anonimizado**. O padrão compliant (e o que este design faz):

- **soft** = período de graça de 7 dias (reversível) — protege contra erro/coação
- **completo** = após a graça, purga real da PII
- **auditoria** = trilha anonimizada (sem PII) mantida — permitido e recomendado

"Só soft delete pra sempre" **não** é compliant. "Apagar na hora sem graça" é arriscado
(irreversível a um clique). O meio-termo com graça + purga é o certo.

## Mudanças

### Frontend (`src/ui/privacy-data.ts`) — feito, PR
- `showCardMessage(card, msg, kind)` — nunca falha em silêncio.
- `friendlyBackendError(res)` — 503 → "serviço instável, tente em minutos"; "already active
  export" → "você já tem um relatório em preparo, verifique o email"; 401/403 → "sessão
  expirou"; 429 → "aguarde um minuto".
- `handleRequestExport` / `handleRequestDeletion` / `handleCancelDeletion` /
  `handleDownloadExport`: sucesso mostra confirmação verde, erro mostra a frase pt-BR.

### Banco (`supabase/migrations/`) — **pendente de aplicação**
1. `20260507_account_deletion_governance.sql` (já no repo, nunca aplicada) — cria
   `user_deletion_requests`, `account_status_history`, `anonymization_log` + funções.
   Idempotente.
2. `20260904_lgpd_fixes.sql` (novo) — corrige `get_export_status` (CTE em vez de
   sub-selects com coluna ambígua) + expira os pedidos de export presos > 1 dia.

**Aplicar** (Supabase SQL Editor do projeto `kezbssjmgwtrunqeoyir`, nesta ordem), ou
liberar o `psql` no deploy.

## Testes

- Frontend: `vitest` 325 (mensagens são DOM, cobertas pelo fluxo do modal).
- Pós-migração (manual/curl com token real):
  - `POST /user/export/request` → 200 (ou "já tem pedido" tratado)
  - `POST /user/deletion/initiate` → 200
  - `GET /user/export/status` → 200 sem 42702

## Riscos

- Migração `20260507`: só `create ... if not exists` / `create or replace`. Nada é
  dropado. Idempotente. Baixo risco.
- `get_export_status`: assinatura idêntica (mesmo `RETURNS TABLE`), só o corpo muda.
- Expirar pedidos presos: afeta só linhas `requested` com > 24h (que já estão mortas —
  o token de confirmação expirou).

## Follow-up (fora desta fase)

- `telemetry_persistence` table ausente → `/auth/usage` loga erro (tem fallback, não quebra).
- `Access to storage is not allowed from this context` (B12) — investigar frame de origem.
- **P4:** o banco de prod perdeu migrations na migração de infra. Precisa de um
  `supabase db push` / reconciliação completa migrations↔banco.
