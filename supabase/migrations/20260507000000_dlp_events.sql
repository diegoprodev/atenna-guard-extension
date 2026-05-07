-- FASE 2.2: Persistent Telemetry (Database)
-- DLP events table with zero PII, safe metrics only
-- Reference: docs/roadmaps/DLP_ENTERPRISE_ROADMAP.md line 300-326

create table if not exists public.dlp_events (
  id uuid primary key default gen_random_uuid(),

  -- User context
  user_id uuid references auth.users(id) on delete cascade,
  tenant_id uuid nullable,

  -- Event metadata
  event_type text not null,  -- dlp_timeout, dlp_engine_error, dlp_scan_complete, etc
  risk_level text not null check (risk_level in ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),

  -- Entity information (safe — types only, not values)
  entity_types text[] not null default '{}',  -- e.g. ["BR_CPF", "EMAIL"] never values
  entity_count int not null default 0,

  -- Behavioral flags
  was_rewritten boolean default false,
  strict_mode boolean default false,
  mismatch_detected boolean default false,
  timeout_occurred boolean default false,
  error_occurred boolean default false,

  -- Metrics
  duration_ms int nullable,
  score float nullable,  -- Risk score 0-100

  -- Source info
  provider text nullable,  -- "client" or "server"
  endpoint text nullable,  -- "/scan", "/generate-prompts"
  session_id text nullable,

  -- Correlation
  hashed_payload_id text nullable,  -- SHA-256[:16] for correlation without raw content

  -- Safe metadata only (no raw content, no PII patterns)
  metadata jsonb not null default '{}',

  -- Timestamps
  created_at timestamptz not null default now(),
  expires_at timestamptz nullable  -- For retention policies
);

-- Indexes for common queries
create index idx_dlp_events_user_created
  on dlp_events(user_id, created_at desc);

create index idx_dlp_events_risk_level
  on dlp_events(risk_level);

create index idx_dlp_events_entity_types
  on dlp_events using gin(entity_types);

create index idx_dlp_events_session
  on dlp_events(session_id);

create index idx_dlp_events_created_at
  on dlp_events(created_at desc);

create index idx_dlp_events_event_type
  on dlp_events(event_type);

-- Enable RLS
alter table dlp_events enable row level security;

-- RLS Policy: Users can only read their own events
create policy "users_read_own_events"
  on dlp_events
  for select
  using (auth.uid() = user_id);

-- RLS Policy: Authenticated users can insert their own events
create policy "users_insert_own_events"
  on dlp_events
  for insert
  with check (auth.uid() = user_id);

-- RLS Policy: Service role (backend) can insert events
-- Note: service_role bypasses RLS automatically, so this is implicit

-- Table comment
comment on table dlp_events is
  'FASE 2.2: DLP event telemetry with zero PII, safe metrics only. Events are immutable audit trail.';

comment on column dlp_events.entity_types is
  'Entity types detected (e.g. ["BR_CPF", "EMAIL"]), NEVER the actual values';

comment on column dlp_events.hashed_payload_id is
  'SHA-256[:16] hash of original payload for correlation. Used to correlate events across different endpoints without storing raw content.';

comment on column dlp_events.metadata is
  'Safe additional context. Must be sanitized before insert — no PII patterns allowed (CPF, CNPJ, API keys, etc).';

-- Grant access to authenticated users
grant select on dlp_events to authenticated;
grant insert on dlp_events to authenticated;
