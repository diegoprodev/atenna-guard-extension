-- FASE P-ZT.4 — lock de IP único por conta PRO (anti-compartilhamento de login).
-- Idempotente. Rodar no SQL Editor do Supabase.
--
-- 1 linha por usuário PRO. Só o service_role (backend) lê/escreve — nenhuma
-- policy pra anon/authenticated.

create table if not exists public.pro_ip_locks (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  active_ip     text        not null,
  last_seen_at  timestamptz not null default now(),
  claimed_via   text        not null default 'request',  -- 'request' | 'login'
  updated_at    timestamptz not null default now()
);

comment on table public.pro_ip_locks is
  'FASE P-ZT.4 — 1 IP ativo por conta PRO. IP diferente dentro da janela de graça (15 min) é bloqueado.';

alter table public.pro_ip_locks enable row level security;

-- Sem policy = ninguém além do service_role acessa. Explicito pra ficar claro
-- na revisão que a ausência é intencional:
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pro_ip_locks'
  ) then
    raise notice 'pro_ip_locks já tem policy(ies) — revisar se é intencional';
  end if;
end $$;

-- Limpeza: linha de quem não é mais PRO. (Roda no job mensal do backend ou
-- manualmente; aqui só a query de referência.)
-- delete from public.pro_ip_locks l
-- where not exists (
--   select 1 from public.user_plans up
--   where up.user_id = l.user_id and up.plan_type = 'pro' and up.status = 'active'
-- );

-- Verificação
select
  (select count(*) from public.pro_ip_locks) as linhas,
  (select rowsecurity from pg_tables where schemaname='public' and tablename='pro_ip_locks') as rls_on;
