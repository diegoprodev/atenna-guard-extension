-- Migration: 20260515_plans_billing.sql
-- Extends user_plans with billing period, status, and notes for pro plan management.

ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_period IN ('monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_user_plans_status ON public.user_plans(status);
CREATE INDEX IF NOT EXISTS idx_user_plans_plan   ON public.user_plans(plan_type);

-- Update RLS: allow service_role full access
DROP POLICY IF EXISTS "service_write" ON public.user_plans;
CREATE POLICY "service_write" ON public.user_plans
  FOR ALL USING (auth.role() = 'service_role');
