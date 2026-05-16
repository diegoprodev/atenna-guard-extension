-- Migration: 20260515_user_settings.sql
-- Stores per-user extension preferences (badge color, etc.) in Supabase.
-- Replaces chrome.storage.local for settings that should persist across devices/reinstalls.

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_color TEXT NOT NULL DEFAULT 'transparent'
    CHECK (badge_color IN ('green','blue','yellow','white','red','transparent')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_settings_read"  ON public.user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_own_settings_write" ON public.user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_own_settings_update" ON public.user_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "service_full_access" ON public.user_settings
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger: keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_user_settings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_user_settings_updated ON public.user_settings;
CREATE TRIGGER trg_user_settings_updated
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_user_settings();
