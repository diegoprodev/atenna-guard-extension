-- FASE 5.1 — RLS Audit Migration
-- Apply via Supabase Dashboard > SQL Editor, or via psql

-- ============================================================
-- dlp_events: users can only see/write their own rows
-- ============================================================
ALTER TABLE IF EXISTS dlp_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dlp_events_user_select ON dlp_events;
CREATE POLICY dlp_events_user_select ON dlp_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS dlp_events_user_insert ON dlp_events;
CREATE POLICY dlp_events_user_insert ON dlp_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS dlp_events_user_delete ON dlp_events;
CREATE POLICY dlp_events_user_delete ON dlp_events
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- user_dlp_stats
-- ============================================================
ALTER TABLE IF EXISTS user_dlp_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stats_user_select ON user_dlp_stats;
CREATE POLICY stats_user_select ON user_dlp_stats
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS stats_user_upsert ON user_dlp_stats;
CREATE POLICY stats_user_upsert ON user_dlp_stats
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- user_plans (read by user; writes by service role only)
-- ============================================================
ALTER TABLE IF EXISTS user_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_user_select ON user_plans;
CREATE POLICY plans_user_select ON user_plans
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- dlp_audit_log (append-only by service role; user can read own)
-- ============================================================
ALTER TABLE IF EXISTS dlp_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_user_select ON dlp_audit_log;
CREATE POLICY audit_user_select ON dlp_audit_log
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- daily_quota (new table for server-side quota enforcement)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_quota (
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date      date NOT NULL DEFAULT current_date,
  count     int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

ALTER TABLE daily_quota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quota_user ON daily_quota;
CREATE POLICY quota_user ON daily_quota
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- increment_daily_quota RPC (atomic check-and-increment)
-- SECURITY DEFINER: runs as DB owner, bypasses RLS for the insert
-- ============================================================
CREATE OR REPLACE FUNCTION increment_daily_quota(p_user_id uuid, p_limit int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO daily_quota (user_id, date, count)
  VALUES (p_user_id, current_date, 1)
  ON CONFLICT (user_id, date) DO UPDATE
    SET count = daily_quota.count + 1
  RETURNING count INTO v_count;

  RETURN json_build_object(
    'new_count', v_count,
    'allowed',   v_count <= p_limit
  );
END;
$$;
