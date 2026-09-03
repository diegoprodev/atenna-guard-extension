-- FASE 10.6 — feedback de desinstalação (off-boarding)
-- Coletado por POST /uninstall-feedback (público, sem auth: a extensão já foi removida).
-- Só o service role escreve; leitura é do admin.

create table if not exists public.uninstall_feedback (
  id           uuid primary key default gen_random_uuid(),
  reason       text not null,
  detail       text,
  email        text,
  ext_version  text,
  created_at   timestamptz not null default now()
);

comment on table public.uninstall_feedback is 'Respostas do formulário mostrado ao desinstalar a extensão (FASE 10.6).';

alter table public.uninstall_feedback enable row level security;

-- Sem policy de select/insert para anon/authenticated:
-- o backend usa a service role key (bypassa RLS). Ninguém mais lê nem escreve.

create index if not exists uninstall_feedback_created_idx
  on public.uninstall_feedback (created_at desc);
