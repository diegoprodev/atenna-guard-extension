-- ============================================================
-- Atenna Prompt — Schema completo
-- Projeto: kezbssjmgwtrunqeoyir
-- ============================================================

-- ── 1. PROFILES ─────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  plan        text not null default 'free',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── 2. SUBSCRIPTIONS ────────────────────────────────────────
create table if not exists public.subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  plan        text not null,
  status      text not null,
  provider    text,
  valid_until timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── 3. USAGE_DAILY ──────────────────────────────────────────
create table if not exists public.usage_daily (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  date                   date not null,
  prompt_generated_count int  not null default 0,
  prompt_used_count      int  not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique(user_id, date)
);

-- ── 4. ANALYTICS_EVENTS ─────────────────────────────────────
create table if not exists public.analytics_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid null references auth.users(id) on delete cascade,
  anonymous_id  text null,
  event_name    text not null,
  event_payload jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

-- ── 5. PROMPT_GENERATIONS ───────────────────────────────────
create table if not exists public.prompt_generations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid null references auth.users(id) on delete cascade,
  anonymous_id     text null,
  input_length     int,
  output_variants  jsonb,
  source           text,
  created_at       timestamptz not null default now()
);

-- ── 6. ÍNDICES ───────────────────────────────────────────────
create index if not exists idx_usage_daily_user_date
  on public.usage_daily (user_id, date);

create index if not exists idx_analytics_events_user_id
  on public.analytics_events (user_id);

create index if not exists idx_analytics_events_anon_id
  on public.analytics_events (anonymous_id);

create index if not exists idx_prompt_generations_user_id
  on public.prompt_generations (user_id);

-- ── 7. TRIGGER: auto-criar profile ao signup ─────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 8. ATIVAR RLS ────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.usage_daily       enable row level security;
alter table public.analytics_events  enable row level security;
alter table public.prompt_generations enable row level security;

-- ── 9. POLÍTICAS RLS — profiles ──────────────────────────────
drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── 10. POLÍTICAS RLS — subscriptions ────────────────────────
drop policy if exists "subscriptions: select own" on public.subscriptions;
create policy "subscriptions: select own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- ── 11. POLÍTICAS RLS — usage_daily ──────────────────────────
drop policy if exists "usage_daily: select own" on public.usage_daily;
create policy "usage_daily: select own"
  on public.usage_daily for select
  using (auth.uid() = user_id);

drop policy if exists "usage_daily: insert own" on public.usage_daily;
create policy "usage_daily: insert own"
  on public.usage_daily for insert
  with check (auth.uid() = user_id);

drop policy if exists "usage_daily: update own" on public.usage_daily;
create policy "usage_daily: update own"
  on public.usage_daily for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 12. POLÍTICAS RLS — analytics_events ─────────────────────
-- Usuário autenticado: insert e select dos próprios eventos
drop policy if exists "analytics_events: insert auth" on public.analytics_events;
create policy "analytics_events: insert auth"
  on public.analytics_events for insert
  with check (
    auth.uid() = user_id
    or (user_id is null and anonymous_id is not null)
  );

drop policy if exists "analytics_events: select own" on public.analytics_events;
create policy "analytics_events: select own"
  on public.analytics_events for select
  using (
    auth.uid() = user_id
  );

-- ── 13. POLÍTICAS RLS — prompt_generations ───────────────────
drop policy if exists "prompt_generations: insert" on public.prompt_generations;
create policy "prompt_generations: insert"
  on public.prompt_generations for insert
  with check (
    auth.uid() = user_id
    or (user_id is null and anonymous_id is not null)
  );

drop policy if exists "prompt_generations: select own" on public.prompt_generations;
create policy "prompt_generations: select own"
  on public.prompt_generations for select
  using (auth.uid() = user_id);
