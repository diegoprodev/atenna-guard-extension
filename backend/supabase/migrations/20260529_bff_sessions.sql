-- FASE 8.0: BFF Sessions persistence (P0-3)
-- Run once in Supabase SQL editor to enable session persistence across backend restarts.
-- Without this table, sessions fall back to in-memory (restart = logout).

CREATE TABLE IF NOT EXISTS bff_sessions (
  token TEXT PRIMARY KEY,
  supabase_jwt TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  role TEXT,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bff_sessions_expires ON bff_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_bff_sessions_user_id ON bff_sessions (user_id);

ALTER TABLE bff_sessions ENABLE ROW LEVEL SECURITY;

-- Verify
SELECT 'bff_sessions ready' AS status, count(*) AS rows FROM bff_sessions;
