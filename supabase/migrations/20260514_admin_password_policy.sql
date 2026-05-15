-- Migration: 20260514_admin_password_policy.sql
-- Adds server-side password strength validation for super_admin accounts.
-- Enforcement: called by backend before any password change via Supabase Auth Admin API.

-- ============================================================
-- 1. Validation function (called from backend via RPC)
--    Returns TRUE if password meets policy, FALSE otherwise.
--    Accepts plaintext — called BEFORE hashing.
-- ============================================================
CREATE OR REPLACE FUNCTION private.validate_admin_password(p TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Minimum 12 characters
  IF length(p) < 12 THEN RETURN FALSE; END IF;
  -- At least one uppercase letter
  IF p !~ '[A-Z]' THEN RETURN FALSE; END IF;
  -- At least one lowercase letter
  IF p !~ '[a-z]' THEN RETURN FALSE; END IF;
  -- At least one digit
  IF p !~ '[0-9]' THEN RETURN FALSE; END IF;
  -- At least one special character
  IF p !~ '[!@#$%^&*()_+\-=\[\]{};''":\\|,.<>\/?`~]' THEN RETURN FALSE; END IF;
  RETURN TRUE;
END;
$$;

-- Only service_role can call this function
REVOKE ALL ON FUNCTION private.validate_admin_password(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.validate_admin_password(TEXT) TO service_role;

-- ============================================================
-- 2. Audit trigger: log password changes for super_admin
--    Fires when encrypted_password changes on an admin user.
-- ============================================================
CREATE OR REPLACE FUNCTION private.log_admin_password_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := (NEW.raw_app_meta_data->>'role')::text;
  IF v_role = 'super_admin' AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    INSERT INTO public.admin_audit_events (actor_id, action, target_id, after, correlation_id)
    VALUES (
      NEW.id::text,
      'user.password_changed',
      NEW.id::text,
      jsonb_build_object('email', NEW.email, 'role', v_role),
      gen_random_uuid()::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_password_audit ON auth.users;
CREATE TRIGGER trg_admin_password_audit
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.log_admin_password_change();

-- ============================================================
-- NOTE: Supabase Dashboard setting (manual, one-time)
-- Authentication → Policies → Password strength:
--   Minimum password length: 12
--   (Special char / uppercase enforcement is backend-only above)
-- ============================================================
