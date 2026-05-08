/**
 * FASE 3.1A: Account Deletion Governance
 *
 * Implementa ciclo de vida seguro de exclusão de conta conforme LGPD.
 * Soft delete com grace period, email confirmation, e anonimização.
 *
 * Lifecycle:
 * ACTIVE → PENDING_DELETION → DELETION_SCHEDULED → PURGED → ANONYMIZED
 *
 * Princípio: Não apagar imediatamente. Governar ciclo de vida.
 */

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: user_deletion_requests
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.user_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending_confirmation',
    check (status in (
      'pending_confirmation',
      'confirmed',
      'deletion_scheduled',
      'purging',
      'purged',
      'anonymized',
      'cancelled'
    )),
  reason text,
  confirmation_token text not null unique,
  confirmation_expires_at timestamptz not null,
  deletion_scheduled_at timestamptz,
  purge_started_at timestamptz,
  purge_completed_at timestamptz,
  anonymized_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_deletion_requests is
  'LGPD Art. 17: Registro de solicitações de exclusão de conta com lifecycle';
comment on column public.user_deletion_requests.status is
  'Lifecycle: pending_confirmation → confirmed → deletion_scheduled → purging → purged → anonymized';
comment on column public.user_deletion_requests.confirmation_token is
  'Token seguro enviado por email (não reutilizável)';
comment on column public.user_deletion_requests.confirmation_expires_at is
  'Token válido por 24 horas (configurável)';

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: account_status_history
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.account_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status_before text,
  status_after text not null,
  reason text,
  triggered_by text, -- 'user', 'admin', 'system', 'retention'
  created_at timestamptz not null default now()
);

comment on table public.account_status_history is
  'Auditoria de transições de status de conta (anonimizável)';

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: anonymization_log
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.anonymization_log (
  id uuid primary key default gen_random_uuid(),
  user_id_hash text not null, -- SHA256 do user_id, não o próprio ID
  operation text not null,    -- 'audit_trail_anonymized', 'event_log_anonymized', etc
  tables_affected text[],     -- quais tabelas foram anonimizadas
  records_anonymized int,
  created_at timestamptz not null default now()
);

comment on table public.anonymization_log is
  'Log de operações de anonimização (preservado para compliance, sem PII)';

-- ═══════════════════════════════════════════════════════════════════════════
-- ENUM TYPE: Account Status
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  create type account_status as enum (
    'active',
    'pending_deletion',
    'deletion_scheduled',
    'purged',
    'anonymized'
  );
exception when duplicate_object then null;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: initiate_account_deletion
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.initiate_account_deletion(
  p_user_id uuid,
  p_email text,
  p_reason text default null
) returns jsonb as $$
declare
  v_confirmation_token text;
  v_expires_at timestamptz;
begin
  -- Generate secure token
  v_confirmation_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := now() + interval '24 hours';

  -- Insert deletion request
  insert into public.user_deletion_requests (
    user_id,
    email,
    reason,
    confirmation_token,
    confirmation_expires_at,
    status
  ) values (
    p_user_id,
    p_email,
    p_reason,
    v_confirmation_token,
    v_expires_at,
    'pending_confirmation'
  );

  -- Log status change
  insert into public.account_status_history (
    user_id,
    status_before,
    status_after,
    reason,
    triggered_by
  ) values (
    p_user_id,
    'active',
    'pending_deletion',
    'User initiated account deletion',
    'user'
  );

  return jsonb_build_object(
    'success', true,
    'confirmation_token', v_confirmation_token,
    'expires_at', v_expires_at,
    'message', 'Deletion request created. Email sent for confirmation.'
  );
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: confirm_account_deletion
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.confirm_account_deletion(
  p_confirmation_token text,
  p_grace_period_days int default 7
) returns jsonb as $$
declare
  v_deletion_request public.user_deletion_requests%rowtype;
  v_user_id uuid;
  v_scheduled_at timestamptz;
begin
  -- Get deletion request
  select * into v_deletion_request
  from public.user_deletion_requests
  where confirmation_token = p_confirmation_token
    and status = 'pending_confirmation'
    and confirmation_expires_at > now();

  if v_deletion_request is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Token inválido ou expirado'
    );
  end if;

  v_user_id := v_deletion_request.user_id;
  v_scheduled_at := now() + make_interval(days => p_grace_period_days);

  -- Update request status
  update public.user_deletion_requests
  set
    status = 'deletion_scheduled',
    deletion_scheduled_at = v_scheduled_at,
    updated_at = now()
  where id = v_deletion_request.id;

  -- Log status change
  insert into public.account_status_history (
    user_id,
    status_before,
    status_after,
    reason,
    triggered_by
  ) values (
    v_user_id,
    'pending_deletion',
    'deletion_scheduled',
    format('Deletion scheduled for %s (grace period: %s days)',
           v_scheduled_at::date, p_grace_period_days),
    'user'
  );

  return jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'deletion_scheduled_at', v_scheduled_at,
    'grace_period_days', p_grace_period_days,
    'message', format(
      'Account deletion confirmed. Data will be purged on %s.',
      v_scheduled_at::date
    )
  );
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: execute_account_purge
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.execute_account_purge(
  p_user_id uuid
) returns jsonb as $$
declare
  v_deletion_request public.user_deletion_requests%rowtype;
  v_start_time timestamptz;
  v_total_records_deleted int := 0;
  v_error_msg text;
begin
  v_start_time := now();

  -- Get deletion request
  select * into v_deletion_request
  from public.user_deletion_requests
  where user_id = p_user_id
    and status = 'deletion_scheduled'
    and deletion_scheduled_at <= now();

  if v_deletion_request is null then
    return jsonb_build_object(
      'success', false,
      'error', 'No scheduled deletion found or grace period not elapsed'
    );
  end if;

  begin
    -- Update status to purging
    update public.user_deletion_requests
    set
      status = 'purging',
      purge_started_at = now(),
      updated_at = now()
    where id = v_deletion_request.id;

    -- Step 1: Delete DLP events
    delete from public.dlp_events where user_id = p_user_id;
    v_total_records_deleted := v_total_records_deleted + found;

    -- Step 2: Delete user stats
    delete from public.user_dlp_stats where user_id = p_user_id;
    v_total_records_deleted := v_total_records_deleted + found;

    -- Step 3: Delete retention logs for this user
    delete from public.dlp_retention_logs
    where execution_id like 'user_' || p_user_id::text || '%';
    v_total_records_deleted := v_total_records_deleted + found;

    -- Step 4: Anonymize audit logs (keep for compliance, remove PII)
    update public.account_status_history
    set user_id = null
    where user_id = p_user_id;

    -- Step 5: Mark deletion request as completed
    update public.user_deletion_requests
    set
      status = 'purged',
      purge_completed_at = now(),
      updated_at = now()
    where id = v_deletion_request.id;

    -- Step 6: Log anonymization
    insert into public.anonymization_log (
      user_id_hash,
      operation,
      tables_affected,
      records_anonymized
    ) values (
      encode(digest(p_user_id::text, 'sha256'), 'hex'),
      'account_purge_completed',
      array['dlp_events', 'user_dlp_stats', 'account_status_history'],
      v_total_records_deleted
    );

    -- Step 7: Emit telemetry event (without user_id)
    insert into public.dlp_events (
      event_type,
      risk_level,
      entity_types,
      entity_count,
      duration_ms,
      endpoint,
      session_id,
      created_at
    ) values (
      'account_purge_completed',
      'SYSTEM',
      array['ACCOUNT_LIFECYCLE']::text[],
      v_total_records_deleted,
      extract(epoch from (now() - v_start_time))::int,
      '/system/account-deletion',
      v_deletion_request.id,
      now()
    );

    return jsonb_build_object(
      'success', true,
      'user_id', p_user_id,
      'purge_completed_at', now(),
      'records_deleted', v_total_records_deleted,
      'duration_ms', extract(epoch from (now() - v_start_time))::int,
      'message', 'Account data purged successfully'
    );

  exception when others then
    v_error_msg := SQLERRM;

    -- Log failure
    update public.user_deletion_requests
    set
      status = 'deletion_scheduled',
      updated_at = now()
    where id = v_deletion_request.id;

    -- Emit error event
    insert into public.dlp_events (
      event_type,
      risk_level,
      entity_types,
      entity_count,
      error_occurred,
      endpoint,
      session_id,
      created_at
    ) values (
      'account_purge_failed',
      'UNKNOWN',
      array['ACCOUNT_LIFECYCLE_ERROR']::text[],
      0,
      true,
      '/system/account-deletion',
      v_deletion_request.id,
      now()
    );

    return jsonb_build_object(
      'success', false,
      'error', v_error_msg,
      'will_retry', true,
      'message', 'Purge failed, will retry next scheduled run'
    );
  end;
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: cancel_account_deletion
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.cancel_account_deletion(
  p_user_id uuid,
  p_reason text default null
) returns jsonb as $$
declare
  v_deletion_request public.user_deletion_requests%rowtype;
begin
  -- Get pending deletion request
  select * into v_deletion_request
  from public.user_deletion_requests
  where user_id = p_user_id
    and status in ('pending_deletion', 'deletion_scheduled')
  order by created_at desc
  limit 1;

  if v_deletion_request is null then
    return jsonb_build_object(
      'success', false,
      'error', 'No pending deletion found'
    );
  end if;

  -- Only allow cancellation before grace period ends
  if v_deletion_request.deletion_scheduled_at < now() then
    return jsonb_build_object(
      'success', false,
      'error', 'Grace period elapsed, deletion cannot be cancelled'
    );
  end if;

  -- Update request
  update public.user_deletion_requests
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = p_reason,
    updated_at = now()
  where id = v_deletion_request.id;

  -- Log status change
  insert into public.account_status_history (
    user_id,
    status_before,
    status_after,
    reason,
    triggered_by
  ) values (
    p_user_id,
    'deletion_scheduled',
    'active',
    coalesce(p_reason, 'User cancelled deletion'),
    'user'
  );

  return jsonb_build_object(
    'success', true,
    'message', 'Account deletion cancelled. Your account is active again.'
  );
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEX: For deletion queries
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists idx_user_deletion_requests_user_id
  on public.user_deletion_requests(user_id);

create index if not exists idx_user_deletion_requests_status
  on public.user_deletion_requests(status);

create index if not exists idx_user_deletion_requests_scheduled
  on public.user_deletion_requests(deletion_scheduled_at)
  where status = 'deletion_scheduled' and deletion_scheduled_at <= now();

create index if not exists idx_account_status_history_user_id
  on public.account_status_history(user_id);

create index if not exists idx_anonymization_log_created
  on public.anonymization_log(created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: user_deletion_requests
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.user_deletion_requests enable row level security;

drop policy if exists "deletion_requests: select own" on public.user_deletion_requests;
create policy "deletion_requests: select own"
  on public.user_deletion_requests for select
  using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: account_status_history
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.account_status_history enable row level security;

drop policy if exists "status_history: select own" on public.account_status_history;
create policy "status_history: select own"
  on public.account_status_history for select
  using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- GRANTS: Service role (for scheduled jobs)
-- ═══════════════════════════════════════════════════════════════════════════

grant execute on function public.initiate_account_deletion to authenticated;
grant execute on function public.confirm_account_deletion to anon;
grant execute on function public.cancel_account_deletion to authenticated;
grant execute on function public.execute_account_purge to service_role;

grant select, insert, update on public.user_deletion_requests to service_role;
grant select, insert on public.account_status_history to service_role;
grant select, insert on public.anonymization_log to service_role;
