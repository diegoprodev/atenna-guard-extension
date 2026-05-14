-- Migration: 20260514_super_admin_schema.sql
-- FASE 5.0 — Super Admin Control Plane
-- Creates admin views, audit tables, feature flags, error events, system snapshots, and RLS policies.

-- ============================================================
-- 0. Ensure user_plans exists (dependency for admin_user_view)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_plans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL UNIQUE,
  plan_type  TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'pro', 'enterprise')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own" ON public.user_plans
  FOR SELECT USING (auth.uid()::text = user_id);

-- ============================================================
-- 1. Secure view: admin_user_view (in private schema)
--    NOT exposed to PostgREST — accessible only via service_role.
--    Fixes: auth_users_exposed + security_definer_view lints.
-- ============================================================
DROP VIEW IF EXISTS public.admin_user_view;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM anon, authenticated, public;

CREATE OR REPLACE VIEW private.admin_user_view
  WITH (security_invoker = true)
AS
SELECT
  u.id,
  u.email,
  u.created_at,
  u.last_sign_in_at,
  u.banned_until,
  (u.raw_app_meta_data->>'role')::text AS role,
  p.plan_type,
  p.updated_at AS plan_updated_at
FROM auth.users u
LEFT JOIN public.user_plans p ON p.user_id = u.id::text;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT ON private.admin_user_view TO service_role;

-- ============================================================
-- 2. Table: admin_audit_events
--    Immutable log of all admin actions for compliance.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       TEXT        NOT NULL,
  action         TEXT        NOT NULL,
  target_id      TEXT,
  before         JSONB,
  after          JSONB,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor   ON public.admin_audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_events(created_at DESC);

-- ============================================================
-- 3. Table: admin_feature_flags
--    Runtime toggles for product features.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_feature_flags (
  name        TEXT        PRIMARY KEY,
  enabled     BOOLEAN     NOT NULL DEFAULT false,
  description TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed known flags; skip if already present
INSERT INTO public.admin_feature_flags (name, enabled, description) VALUES
  ('MULTIMODAL_ENABLED',      false, 'Enable document upload widget and badge upload icon'),
  ('DOCUMENT_DLP_ENABLED',    true,  'Run DLP scan on documents (when MULTIMODAL_ENABLED)'),
  ('STRICT_DOCUMENT_MODE',    true,  'High risk documents must be protected before sending'),
  ('DOCUMENT_UPLOAD_ENABLED', false, 'Enable /document/upload endpoint'),
  ('STRICT_DLP_MODE',         false, 'Force protection on HIGH risk — no override allowed')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 4. Table: admin_error_events
--    Sanitized error log (no PII in error_message).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_error_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status_code    INTEGER     NOT NULL,
  endpoint       TEXT        NOT NULL,
  method         TEXT,
  correlation_id TEXT,
  user_id        TEXT,
  error_type     TEXT,
  error_message  TEXT,  -- sanitized, no PII
  severity       TEXT CHECK (severity IN ('low','medium','high','critical')) DEFAULT 'medium',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_errors_created ON public.admin_error_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_errors_status  ON public.admin_error_events(status_code);

-- ============================================================
-- 5. Table: admin_system_snapshots
--    Point-in-time VPS/container health metrics.
--    Retention: application layer must purge rows older than 7 days.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_system_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cpu_pct           NUMERIC(5,2),
  mem_used_mb       INTEGER,
  mem_total_mb      INTEGER,
  disk_used_pct     NUMERIC(5,2),
  container_status  TEXT,
  uptime_seconds    BIGINT,
  health_latency_ms INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Retention note: delete rows WHERE created_at < now() - interval '7 days'
-- from the application or a scheduled Supabase cron job.

-- ============================================================
-- 6. RLS Policies
-- ============================================================

-- admin_audit_events — service role only (all user access blocked)
ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_only" ON public.admin_audit_events;
CREATE POLICY "service_only" ON public.admin_audit_events
  USING (false);  -- blocks all non-service-role access

-- admin_feature_flags — authenticated users can read; service role can write
ALTER TABLE public.admin_feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_authenticated" ON public.admin_feature_flags;
DROP POLICY IF EXISTS "write_service"      ON public.admin_feature_flags;
CREATE POLICY "read_authenticated" ON public.admin_feature_flags
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "write_service" ON public.admin_feature_flags
  FOR ALL USING (auth.role() = 'service_role');

-- admin_error_events — service role only
ALTER TABLE public.admin_error_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_only" ON public.admin_error_events;
CREATE POLICY "service_only" ON public.admin_error_events
  USING (false);

-- admin_system_snapshots — service role only
ALTER TABLE public.admin_system_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_only" ON public.admin_system_snapshots;
CREATE POLICY "service_only" ON public.admin_system_snapshots
  USING (false);
