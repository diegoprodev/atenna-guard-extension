# FASE P-ZT — Blindagem anti-IDOR

**Origem:** o dono pediu "políticas anti-IDOR" depois do vazamento de histórico entre contas.
**IDOR** = Insecure Direct Object Reference: trocar um ID na URL/parâmetro pra ler ou mexer
no dado de outro usuário.

## Estado atual (auditoria de 2026-09-04)

O vazamento que o dono pegou foi **client-side** (chave de `chrome.storage` sem escopo de
`user_id`) — já corrigido (PR #40). **Não** era IDOR de API. Mas a auditoria confirma:

### O que está OK
Os fluxos de usuário **derivam `user_id` do token**, nunca do cliente:

| Rota | `user_id` vem de | IDOR possível? |
|---|---|---|
| `/auth/me`, `/auth/usage`, `/auth/mark-onboarding-seen` | `session["user_id"]` | não |
| `/user/export/*`, `/user/deletion/*` (incl. `/resend`) | `_user["user_id"]` (via alias `id`/`sub`) | não |
| `/user/export/confirm?token=`, `/user/deletion/confirm?token=` | token de 32 bytes aleatório, uso único (padrão reset de senha) | não |
| `/user/export/download?token=` | token | não |
| `/user/profile` PATCH | `session["user_id"]` | não |
| `/documents/*`, `/protect`, `/export-protected` | `_user["sub"]`/`["id"]` | não |
| `/checkout/webhook/*` | evento **assinado** do provedor (Asaas) | não |
| `upload_large` | valida `uploads/{seu_user_id}/` no path da chave | não |
| `/admin/*` | `require_super_admin` + allowlist `ADMIN_EMAILS` (revalidada a cada request desde a FASE 10.9.4) | só admin (é o propósito) |

### Fraquezas (o que blindar)

| # | Item | Por quê | Risco |
|---|------|---------|-------|
| ZT-1 | **RLS não é a barreira** | o backend usa `SUPABASE_SERVICE_ROLE_KEY` em quase toda query → ignora Row Level Security. Se um dia o `user_id` for derivado errado numa rota (bug), **não há segunda barreira** — foi exatamente o que aconteceu client-side. | Alto |
| ZT-2 | **Sem teste automatizado anti-IDOR** | nenhum teste prova "token do user A não toca no dado do user B" pra cada rota. Regressão passa despercebida. | Alto |
| ZT-3 | `admin/compliance.py:158` `&user_id=eq.{user_id}` | conferir a origem desse `user_id` (query param? path?) e o gate. | Médio |
| ZT-4 | **Sem audit log de leitura de PII** | se o service_role for usado indevidamente (ou vazar), não há registro de quem leu o quê. | Médio |
| ZT-5 | Guard de código faltando | nada impede um PR futuro de adicionar uma rota que lê `user_id` do body/query. | Médio → **feito** (`test_anti_idor.py`) |
| ZT-6 | `/dlp/image` usa `request.user_id` (campo do body) na telemetria em vez de `_user["user_id"]` | cliente pode mentir o `user_id` da própria telemetria de scan. Sem exposição de dado (o scan só analisa o texto enviado), mas sujo. | Baixo |
| ZT-7 | `admin/compliance.py` interpola `user_id`/`risk_level`/`entity_type` crus na URL do PostgREST | injeção de filtro por um admin autenticado. Admin já tem acesso total → severidade baixa, mas parametrizar. | Baixo |

## Plano

### Parte 1 — cobertura de teste (esta fase, sem tocar prod)
1. `backend/tests/test_anti_idor.py`:
   - **guard estático:** varre `backend/routes/**.py` e falha se uma rota lê `user_id`
     de `req.`/`body`/`Query`/`Path` **sem** também ter `require_auth`/`require_super_admin`.
   - **comportamental:** pra `/user/export/status`, `/user/export/resend`,
     `/user/deletion/status`, `/user/deletion/resend`, `/auth/me`, `/auth/usage` —
     monta sessão do user A, chama, verifica que só o dado de A é tocado (mock do
     Supabase registra os filtros aplicados).
2. `docs/THREAT_MODEL.md` — atacante = usuário avançado com o próprio token opaco, faz
   replay de request e troca de ID. Resposta-alvo: **nada além da própria cota/dado**.

### Parte 2 — RLS como barreira (fase seguinte, mexe em prod)
1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policy `auth.uid() = user_id` (select/
   update/delete) em: `profiles`, `dlp_events`, `user_dlp_stats`, `user_export_requests`,
   `user_deletion_requests`, `account_status_history`, `bff_sessions`.
   *(algumas já têm — `user_deletion_requests`/`account_status_history` da migration 20260507.)*
2. Onde o dado é do próprio usuário, o backend passa a usar um cliente Supabase com o
   **JWT do usuário** (não o service_role) → RLS bloqueia cross-user mesmo com bug no código.
   `service_role` fica só pra: webhooks, jobs agendados, `execute_account_purge`.
3. Rodar a suíte da Parte 1 antes e depois → prova que RLS não quebrou nada.

### Parte 3 — audit + guard permanente
1. `private.pii_access_log` — trigger/wrapper que registra `SELECT` em massa nas tabelas de PII.
2. Alerta (GlitchTip/Discord) quando `count > N` numa query de PII.
3. O guard estático da Parte 1 vira **check obrigatório** no CI (`ci.yml`).

## Contrato (o que "blindado" significa)
- Toda rota que devolve dado de usuário: token do user A → recurso do user B ⇒ **403/404/vazio**.
- Nenhuma rota aceita `user_id`/`account_id`/`owner` do corpo, query ou path pra dados de
  usuário comum (só rotas `/admin/*` com gate).
- RLS ativa nas 7 tabelas → segunda barreira independente do código.
- Toda leitura de PII em volume fica registrada.

## Riscos
- **RLS (Parte 2) mexe em produção.** Ligar RLS numa tabela sem as policies certas = quebra
  o backend. Por isso a Parte 1 (testes) vem antes, e a Parte 2 roda com a suíte de contraprova.
- Trocar service_role → JWT do usuário exige revisar cada query. Faseado por rota.
