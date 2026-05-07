-- ── user_dlp_stats — cumulative DLP protection counters ──────
-- Run this migration in Supabase Dashboard > SQL Editor

create table if not exists public.user_dlp_stats (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  protected_count   int not null default 0,
  tokens_estimated  int not null default 0,
  scans_total       int not null default 0,
  updated_at        timestamptz not null default now()
);

alter table public.user_dlp_stats enable row level security;

drop policy if exists "dlp_stats: select own" on public.user_dlp_stats;
create policy "dlp_stats: select own"
  on public.user_dlp_stats for select
  using (auth.uid() = user_id);

drop policy if exists "dlp_stats: insert own" on public.user_dlp_stats;
create policy "dlp_stats: insert own"
  on public.user_dlp_stats for insert
  with check (auth.uid() = user_id);

drop policy if exists "dlp_stats: update own" on public.user_dlp_stats;
create policy "dlp_stats: update own"
  on public.user_dlp_stats for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
