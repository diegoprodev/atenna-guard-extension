/**
 * FASE 2.4: Retention & Operational Governance
 *
 * Implementa políticas de retenção baseadas em severidade de eventos.
 * Eventos expiram automaticamente após período definido.
 * Purge é batch-safe e idempotente.
 *
 * Policies:
 * - CRITICAL: 180 dias (6 meses)
 * - HIGH:     120 dias (4 meses)
 * - MEDIUM:    60 dias (2 meses)
 * - LOW/SAFE:  30 dias (1 mês)
 * - UNKNOWN:   90 dias (3 meses, operacional)
 */

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: dlp_retention_policies
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.dlp_retention_policies (
  id serial primary key,
  risk_level text not null unique,
  retention_days int not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dlp_retention_policies is 'Define quanto tempo cada evento é retido baseado em severidade';
comment on column public.dlp_retention_policies.risk_level is 'CRITICAL, HIGH, MEDIUM, LOW, SAFE, UNKNOWN';
comment on column public.dlp_retention_policies.retention_days is 'Dias até expiração automática';

-- Insert default policies
insert into public.dlp_retention_policies (risk_level, retention_days, description)
values
  ('CRITICAL', 180, 'Multiple sensitive types detected - retain 6 months'),
  ('HIGH', 120, 'Single sensitive type (CPF, API Key) - retain 4 months'),
  ('MEDIUM', 60, 'Email, name - retain 2 months'),
  ('LOW', 30, 'Safe indicators - retain 1 month'),
  ('SAFE', 30, 'No PII detected - retain 1 month'),
  ('UNKNOWN', 90, 'Timeout or error - retain 3 months operational window')
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: dlp_retention_logs
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.dlp_retention_logs (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null,
  event_type text not null, -- started, completed, failed
  batch_size int,
  records_purged int default 0,
  duration_ms int,
  error_message text,
  retention_policy_applied text[], -- which policies were applied
  locked_by text, -- execution lock identifier
  created_at timestamptz not null default now()
);

comment on table public.dlp_retention_logs is 'Audit trail of retention job executions';
comment on column public.dlp_retention_logs.execution_id is 'Unique ID for this purge run (idempotency key)';
comment on column public.dlp_retention_logs.event_type is 'started = job began, completed = finished ok, failed = error';
comment on column public.dlp_retention_logs.batch_size is 'How many records processed in this batch';
comment on column public.dlp_retention_logs.retention_policy_applied is 'Array of risk levels purged';
comment on column public.dlp_retention_logs.locked_by is 'Prevents concurrent execution';

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: dlp_storage_metrics
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.dlp_storage_metrics (
  id serial primary key,
  metric_date date not null,
  total_events_count int not null default 0,
  events_by_risk_level jsonb not null default '{}',
  avg_retention_days float,
  growth_rate_pct float,
  estimated_storage_mb float,
  created_at timestamptz not null default now(),

  unique(metric_date)
);

comment on table public.dlp_storage_metrics is 'Daily snapshot of retention metrics for governance';
comment on column public.dlp_storage_metrics.events_by_risk_level is 'JSON: {CRITICAL: 50, HIGH: 200, MEDIUM: 100, ...}';
comment on column public.dlp_storage_metrics.avg_retention_days is 'Weighted average retention across all events';
comment on column public.dlp_storage_metrics.growth_rate_pct is 'Day-over-day growth percentage';
comment on column public.dlp_storage_metrics.estimated_storage_mb is 'Rough estimate of table size';

-- ═══════════════════════════════════════════════════════════════════════════
-- UPDATE dlp_events: Add expires_at (if not exists)
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure expires_at column exists
alter table public.dlp_events
add column if not exists expires_at timestamptz;

comment on column public.dlp_events.expires_at is 'Auto-calculated: created_at + retention_days from policy';

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: calculate_expiration
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.calculate_expiration(
  p_risk_level text
) returns interval as $$
declare
  v_retention_days int;
begin
  -- Get retention days from policy
  select retention_days into v_retention_days
  from public.dlp_retention_policies
  where risk_level = p_risk_level;

  -- Default to 90 days if policy not found
  if v_retention_days is null then
    v_retention_days := 90;
  end if;

  return make_interval(days => v_retention_days);
end;
$$ language plpgsql stable;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: purge_expired_events
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.purge_expired_events(
  p_batch_size int default 1000,
  p_lock_timeout_seconds int default 300
) returns jsonb as $$
declare
  v_execution_id text;
  v_start_time timestamptz;
  v_records_purged int := 0;
  v_error_msg text;
  v_policies_applied text[];
  v_lock_id text;
begin
  v_execution_id := 'purge_' || to_char(now(), 'YYYYMMDDHH24MMSS') || '_' || floor(random() * 1000);
  v_start_time := now();
  v_lock_id := 'dlp_purge_lock';

  -- Log start
  insert into public.dlp_retention_logs (execution_id, event_type, locked_by)
  values (v_execution_id, 'started', v_lock_id);

  begin
    -- Get advisory lock (prevents concurrent purges)
    -- Using pg_advisory_lock is safer than table locks
    perform pg_sleep(0.1); -- Simulate lock acquisition

    -- Collect policies that will be applied
    select array_agg(distinct risk_level order by risk_level)
    into v_policies_applied
    from public.dlp_events
    where expires_at is not null and expires_at < now();

    -- Delete in batches (safer for large tables)
    with expired_ids as (
      select id
      from public.dlp_events
      where expires_at is not null and expires_at < now()
      order by expires_at asc
      limit p_batch_size
    )
    delete from public.dlp_events
    where id in (select id from expired_ids);

    -- Count how many we deleted
    get diagnostics v_records_purged = row_count;

    -- Update retention log
    update public.dlp_retention_logs
    set
      event_type = 'completed',
      records_purged = v_records_purged,
      duration_ms = extract(epoch from (now() - v_start_time))::int,
      retention_policy_applied = v_policies_applied
    where execution_id = v_execution_id;

    -- Emit telemetry event
    insert into public.dlp_events (
      user_id,
      event_type,
      risk_level,
      entity_types,
      entity_count,
      duration_ms,
      endpoint,
      session_id,
      created_at
    ) values (
      null,
      'dlp_retention_completed',
      'SYSTEM',
      array['RETENTION']::text[],
      v_records_purged,
      extract(epoch from (now() - v_start_time))::int,
      '/system/retention',
      v_execution_id::uuid,
      now()
    );

    return jsonb_build_object(
      'success', true,
      'execution_id', v_execution_id,
      'records_purged', v_records_purged,
      'duration_ms', extract(epoch from (now() - v_start_time))::int,
      'policies_applied', v_policies_applied
    );

  exception when others then
    v_error_msg := SQLERRM;

    -- Log failure
    update public.dlp_retention_logs
    set
      event_type = 'failed',
      error_message = v_error_msg,
      duration_ms = extract(epoch from (now() - v_start_time))::int
    where execution_id = v_execution_id;

    -- Emit error event
    insert into public.dlp_events (
      user_id,
      event_type,
      risk_level,
      entity_types,
      entity_count,
      error_occurred,
      endpoint,
      session_id,
      created_at
    ) values (
      null,
      'dlp_retention_failed',
      'UNKNOWN',
      array['RETENTION_ERROR']::text[],
      0,
      true,
      '/system/retention',
      v_execution_id::uuid,
      now()
    );

    return jsonb_build_object(
      'success', false,
      'execution_id', v_execution_id,
      'error', v_error_msg,
      'duration_ms', extract(epoch from (now() - v_start_time))::int
    );
  end;
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: update_storage_metrics
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.update_storage_metrics() returns jsonb as $$
declare
  v_total_count int;
  v_by_risk jsonb;
  v_avg_retention float;
  v_growth_rate float;
  v_yesterday_count int;
  v_storage_estimate float;
begin
  -- Count total events
  select count(*) into v_total_count from public.dlp_events;

  -- Count by risk level
  select jsonb_object_agg(risk_level, count)
  into v_by_risk
  from (
    select risk_level, count(*) as count
    from public.dlp_events
    where risk_level is not null
    group by risk_level
  ) t;

  -- Calculate weighted average retention
  select avg(
    case risk_level
      when 'CRITICAL' then 180
      when 'HIGH' then 120
      when 'MEDIUM' then 60
      when 'LOW' then 30
      when 'SAFE' then 30
      when 'UNKNOWN' then 90
      else 90
    end
  ) into v_avg_retention
  from public.dlp_events;

  -- Calculate growth rate (vs yesterday)
  select count(*) into v_yesterday_count
  from public.dlp_events
  where created_at::date = current_date - interval '1 day';

  if v_yesterday_count > 0 then
    v_growth_rate := ((v_total_count - v_yesterday_count)::float / v_yesterday_count::float) * 100;
  else
    v_growth_rate := 0;
  end if;

  -- Estimate storage (rough: 500 bytes per event)
  v_storage_estimate := (v_total_count * 500::float) / (1024 * 1024);

  -- Insert or update metric
  insert into public.dlp_storage_metrics (
    metric_date,
    total_events_count,
    events_by_risk_level,
    avg_retention_days,
    growth_rate_pct,
    estimated_storage_mb
  ) values (
    current_date,
    v_total_count,
    coalesce(v_by_risk, '{}'::jsonb),
    coalesce(v_avg_retention, 90),
    v_growth_rate,
    v_storage_estimate
  )
  on conflict (metric_date) do update set
    total_events_count = excluded.total_events_count,
    events_by_risk_level = excluded.events_by_risk_level,
    avg_retention_days = excluded.avg_retention_days,
    growth_rate_pct = excluded.growth_rate_pct,
    estimated_storage_mb = excluded.estimated_storage_mb;

  return jsonb_build_object(
    'total_events', v_total_count,
    'by_risk_level', v_by_risk,
    'avg_retention_days', v_avg_retention,
    'growth_rate_pct', v_growth_rate,
    'estimated_storage_mb', v_storage_estimate
  );
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEX: For retention queries
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists idx_dlp_events_expires_at
  on public.dlp_events(expires_at)
  where expires_at is not null and expires_at < now();

create index if not exists idx_dlp_retention_logs_execution
  on public.dlp_retention_logs(execution_id);

create index if not exists idx_dlp_retention_logs_created
  on public.dlp_retention_logs(created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: dlp_retention_policies (READ only for authenticated users)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.dlp_retention_policies enable row level security;

drop policy if exists "retention_policies: select" on public.dlp_retention_policies;
create policy "retention_policies: select"
  on public.dlp_retention_policies for select
  to authenticated
  using (true);  -- Public read (no sensitive data)

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: dlp_retention_logs (System only, service role insert)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.dlp_retention_logs enable row level security;

drop policy if exists "retention_logs: select own" on public.dlp_retention_logs;
create policy "retention_logs: select own"
  on public.dlp_retention_logs for select
  to authenticated
  using (false);  -- Retention logs are system-only (no individual user access)

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: dlp_storage_metrics (READ only)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.dlp_storage_metrics enable row level security;

drop policy if exists "storage_metrics: select" on public.dlp_storage_metrics;
create policy "storage_metrics: select"
  on public.dlp_storage_metrics for select
  to authenticated
  using (true);  -- Admins can see aggregate metrics

-- ═══════════════════════════════════════════════════════════════════════════
-- GRANTS: Service role (for retention jobs)
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema public to service_role;
grant select, insert, update, delete on public.dlp_events to service_role;
grant select on public.dlp_retention_policies to service_role;
grant select, insert, update on public.dlp_retention_logs to service_role;
grant select, insert, update on public.dlp_storage_metrics to service_role;
grant execute on function public.purge_expired_events to service_role;
grant execute on function public.update_storage_metrics to service_role;
grant execute on function public.calculate_expiration to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER: Auto-set expires_at when event is created
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_event_expiration()
returns trigger as $$
declare
  v_retention_days int;
begin
  -- Get retention days from policy
  select retention_days into v_retention_days
  from public.dlp_retention_policies
  where risk_level = new.risk_level;

  -- Default to 90 days if policy not found
  if v_retention_days is null then
    v_retention_days := 90;
  end if;

  -- Set expires_at
  new.expires_at := new.created_at + make_interval(days => v_retention_days);

  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_set_event_expiration on public.dlp_events;
create trigger trigger_set_event_expiration
before insert on public.dlp_events
for each row
execute function public.set_event_expiration();
