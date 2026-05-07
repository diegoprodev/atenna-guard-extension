/**
 * FASE 2.4: User DLP Stats Sync
 *
 * Enriquece user_dlp_stats com triggers para auto-atualização
 * baseada em eventos reais do DLP.
 *
 * Sincroniza:
 * - protected_count: quantas vezes rewrite foi aplicado
 * - tokens_estimated: quantos tokens foram substituídos
 * - scans_total: total de scans (detectadas ou não)
 */

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: increment_user_dlp_stats
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.increment_user_dlp_stats(
  p_user_id uuid,
  p_increment_protected int default 0,
  p_increment_tokens int default 0,
  p_increment_scans int default 1
) returns void as $$
begin
  -- Insert or update user stats
  insert into public.user_dlp_stats (user_id, protected_count, tokens_estimated, scans_total, updated_at)
  values (p_user_id, p_increment_protected, p_increment_tokens, p_increment_scans, now())
  on conflict (user_id) do update set
    protected_count = user_dlp_stats.protected_count + p_increment_protected,
    tokens_estimated = user_dlp_stats.tokens_estimated + p_increment_tokens,
    scans_total = user_dlp_stats.scans_total + p_increment_scans,
    updated_at = now();
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER: Update stats on dlp_scan_complete events
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.trigger_update_stats_on_scan()
returns trigger as $$
declare
  v_tokens_rewritten int := 0;
begin
  -- Only process dlp_scan_complete events
  if new.event_type != 'dlp_scan_complete' then
    return new;
  end if;

  -- Skip system events (no user_id)
  if new.user_id is null then
    return new;
  end if;

  -- Count tokens rewritten (rough estimate: 1 token per PII entity)
  if new.was_rewritten then
    v_tokens_rewritten := coalesce(new.entity_count, 1);
  end if;

  -- Update user stats
  perform public.increment_user_dlp_stats(
    p_user_id => new.user_id,
    p_increment_protected => case when new.was_rewritten then 1 else 0 end,
    p_increment_tokens => v_tokens_rewritten,
    p_increment_scans => 1
  );

  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_update_stats_on_dlp_scan on public.dlp_events;
create trigger trigger_update_stats_on_dlp_scan
after insert on public.dlp_events
for each row
execute function public.trigger_update_stats_on_scan();

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTION: calculate_user_protection_rate
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.calculate_user_protection_rate(
  p_user_id uuid
) returns table (
  protection_rate float,
  events_protected int,
  events_total int,
  avg_tokens_per_event float
) as $$
begin
  return query
  select
    case
      when scans_total = 0 then 0.0
      else (protected_count::float / scans_total::float) * 100
    end as protection_rate,
    protected_count as events_protected,
    scans_total as events_total,
    case
      when protected_count = 0 then 0.0
      else tokens_estimated::float / protected_count::float
    end as avg_tokens_per_event
  from public.user_dlp_stats
  where user_id = p_user_id;
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- VIEW: user_dlp_summary
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.user_dlp_summary as
select
  s.user_id,
  s.protected_count,
  s.tokens_estimated,
  s.scans_total,
  case
    when s.scans_total = 0 then 0.0
    else (s.protected_count::float / s.scans_total::float) * 100
  end as protection_rate_pct,
  case
    when s.protected_count = 0 then 0
    else round(s.tokens_estimated::float / s.protected_count::float, 2)
  end as avg_tokens_per_protection,
  s.updated_at
from public.user_dlp_stats s;

-- ═══════════════════════════════════════════════════════════════════════════
-- GRANTS: Authenticated users can read own stats
-- ═══════════════════════════════════════════════════════════════════════════

grant execute on function public.increment_user_dlp_stats to service_role;
grant execute on function public.calculate_user_protection_rate to authenticated;
grant select on public.user_dlp_summary to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEX: For stats queries
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists idx_user_dlp_stats_updated_at on public.user_dlp_stats(updated_at desc);
