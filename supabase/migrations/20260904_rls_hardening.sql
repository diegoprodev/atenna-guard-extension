-- FASE P-ZT parte 2 — endurece RLS (anti-IDOR)
--
-- ACHADO NA AUDITORIA (2026-09-04): RLS já estava HABILITADA nas 9 tabelas de
-- dado de usuário, e as policies existentes já usam corretamente
-- `auth.uid() = user_id` (nenhuma policy `USING (true)` encontrada). O
-- "vazamento" que motivou esta fase (histórico entre contas) era client-side,
-- não uma falha de RLS.
--
-- Dois problemas reais achados nesta auditoria:
--
--  1. **`anon` e `authenticated` têm GRANT completo** (SELECT/INSERT/UPDATE/
--     DELETE/TRUNCATE/REFERENCES/TRIGGER) em TODAS as 9 tabelas, incluindo
--     `bff_sessions` (tokens de sessão!). RLS torna a maioria disso inofensivo
--     hoje (nenhuma policy libera `anon`, e `auth.uid()` é NULL pra ele), MAS:
--       - TRUNCATE não é filtrado por RLS — é tudo-ou-nada. Se um dia uma
--         function/RPC rodar como `authenticated`/`anon` e chamar TRUNCATE,
--         apaga a tabela inteira. Não devia ter esse privilégio.
--       - Least privilege: se uma policy nova um dia for escrita errada
--         (`USING (true)` por engano), o GRANT já aberto vira exposição
--         total imediata, sem aviso. Grant mínimo = essa falha fica contida.
--     Fix: REVOKE tudo de `anon` (não precisa de nada nessas tabelas — o
--     produto exige login pra tudo) e normaliza `authenticated` pro mínimo
--     que as policies existentes realmente autorizam.
--
--  2. **Policies duplicadas** (`dlp_events`, `user_dlp_stats`, `user_plans`,
--     `user_settings` têm 2 policies idênticas pro mesmo comando — sobra de
--     migrations repetidas). Inofensivo (Postgres faz OR entre policies
--     permissivas idênticas) mas dificulta auditoria. Fix: dropa as
--     duplicadas, mantém uma canônica por tabela+comando.
--
-- Zero mudança de comportamento pro backend: ele usa SUPABASE_SERVICE_ROLE_KEY,
-- que tem `rolbypassrls=true` — RLS e esses grants nunca se aplicam a ele
-- (confirmado: `select rolbypassrls from pg_roles where rolname='service_role'` → true).
--
-- Idempotente: todo REVOKE/DROP POLICY IF EXISTS pode rodar mais de uma vez.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. anon — zero acesso às tabelas de dado de usuário
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on public.profiles                from anon;
revoke all on public.dlp_events              from anon;
revoke all on public.user_dlp_stats          from anon;
revoke all on public.user_export_requests    from anon;
revoke all on public.user_deletion_requests  from anon;
revoke all on public.account_status_history  from anon;
revoke all on public.bff_sessions            from anon;
revoke all on public.user_plans              from anon;
revoke all on public.user_settings           from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. authenticated — normaliza pro mínimo que as policies já autorizam
--    (revoke tudo, concede de volta só select/insert/update/delete onde há
--    policy correspondente — nunca truncate/references/trigger)
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on public.profiles                from authenticated;
grant select, update on public.profiles to authenticated;

revoke all on public.dlp_events              from authenticated;
grant select, insert, delete on public.dlp_events to authenticated;

revoke all on public.user_dlp_stats          from authenticated;
grant select, insert, update on public.user_dlp_stats to authenticated;

revoke all on public.user_export_requests    from authenticated;
grant select on public.user_export_requests to authenticated;  -- writes só via backend (service_role)

revoke all on public.user_deletion_requests  from authenticated;
grant select on public.user_deletion_requests to authenticated;

revoke all on public.account_status_history  from authenticated;
grant select on public.account_status_history to authenticated;  -- trilha de auditoria: só leitura

revoke all on public.bff_sessions            from authenticated;  -- ninguém além do service_role toca aqui

revoke all on public.user_plans              from authenticated;
grant select on public.user_plans to authenticated;

revoke all on public.user_settings           from authenticated;
grant select, insert, update on public.user_settings to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Dedup de policies (mesma condição, comando duplicado — mantém 1 por par)
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "users_insert_own_events" on public.dlp_events;   -- fica dlp_events_user_insert
drop policy if exists "users_read_own_events"   on public.dlp_events;   -- fica dlp_events_user_select

drop policy if exists "dlp_stats: insert own" on public.user_dlp_stats; -- fica stats_user_upsert (ALL)
drop policy if exists "dlp_stats: select own" on public.user_dlp_stats; -- fica stats_user_select
drop policy if exists "dlp_stats: update own" on public.user_dlp_stats; -- fica stats_user_upsert (ALL)

drop policy if exists "plans_user_select" on public.user_plans;         -- fica user_own

drop policy if exists "user_own_settings_read"   on public.user_settings; -- fica user_own_read
drop policy if exists "user_own_settings_write"  on public.user_settings; -- fica user_own_insert
drop policy if exists "user_own_settings_update" on public.user_settings; -- fica user_own_update
drop policy if exists "service_full_access"      on public.user_settings; -- fica service_full (idêntica; e nenhuma das
                                                                            -- duas faz efeito de qualquer forma — service_role bypassa RLS)

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Verificação (roda sozinho, só leitura — confirma o resultado)
-- ═══════════════════════════════════════════════════════════════════════════

select 'grants restantes' as check, table_name, grantee, string_agg(privilege_type, ',') as privs
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
  and table_name in ('profiles','dlp_events','user_dlp_stats','user_export_requests',
                      'user_deletion_requests','account_status_history','bff_sessions',
                      'user_plans','user_settings')
group by table_name, grantee
order by table_name, grantee;
