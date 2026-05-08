-- FASE 3.1B: User Data Export Governance
-- LGPD Art. 18 — Direito ao Acesso
-- Implementar requisições de export com lifecycle governado

CREATE TYPE export_status AS ENUM (
  'requested',      -- Solicitação recebida, aguardando confirmação
  'confirmed',      -- Email confirmado, pronto para processar
  'processing',     -- Gerando PDF
  'ready',          -- PDF gerado, aguardando download
  'expired',        -- Janela de download expirou
  'purged',         -- Arquivo deletado, requisição arquivada
  'failed'          -- Erro durante geração
);

CREATE TABLE user_export_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status                      export_status NOT NULL DEFAULT 'requested',

  -- Lifecycle timestamps
  requested_at                TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at                TIMESTAMPTZ,
  processing_started_at       TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,
  expires_at                  TIMESTAMPTZ,
  purged_at                   TIMESTAMPTZ,

  -- Download security
  download_token              TEXT UNIQUE NOT NULL,
  download_count              INT DEFAULT 0,
  max_downloads               INT DEFAULT 3,

  -- Metadata
  created_at                  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_max_downloads CHECK (max_downloads > 0),
  CONSTRAINT valid_download_count CHECK (download_count >= 0 AND download_count <= max_downloads)
);

-- Índices para performance
CREATE INDEX idx_user_export_requests_user_id
  ON user_export_requests(user_id, created_at DESC);
CREATE INDEX idx_user_export_requests_status
  ON user_export_requests(status);
CREATE INDEX idx_user_export_requests_download_token
  ON user_export_requests(download_token);
CREATE INDEX idx_user_export_requests_expires_at
  ON user_export_requests(expires_at);

-- Row Level Security
ALTER TABLE user_export_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_read_own_exports"
  ON user_export_requests
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "service_role_all"
  ON user_export_requests
  USING (auth.role() = 'service_role');

-- Função: iniciar requisição de export
CREATE OR REPLACE FUNCTION initiate_export_request(
  p_user_id UUID,
  p_download_token TEXT
) RETURNS user_export_requests AS $$
DECLARE
  v_result user_export_requests;
BEGIN
  -- Validação: apenas 1 export ativo por usuário
  IF EXISTS (
    SELECT 1 FROM user_export_requests
    WHERE user_id = p_user_id
    AND status NOT IN ('expired', 'purged', 'failed')
  ) THEN
    RAISE EXCEPTION 'User already has an active export request';
  END IF;

  INSERT INTO user_export_requests (user_id, download_token, status)
  VALUES (p_user_id, p_download_token, 'requested')
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função: confirmar requisição via token
CREATE OR REPLACE FUNCTION confirm_export_request(
  p_download_token TEXT,
  p_expires_in_hours INT DEFAULT 48
) RETURNS user_export_requests AS $$
DECLARE
  v_result user_export_requests;
BEGIN
  UPDATE user_export_requests
  SET
    status = 'confirmed',
    confirmed_at = NOW(),
    expires_at = NOW() + (p_expires_in_hours || ' hours')::INTERVAL,
    processing_started_at = NOW()
  WHERE download_token = p_download_token
  AND status = 'requested'
  RETURNING * INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Token not found or already confirmed';
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função: marcar PDF como pronto
CREATE OR REPLACE FUNCTION mark_export_ready(
  p_download_token TEXT
) RETURNS user_export_requests AS $$
DECLARE
  v_result user_export_requests;
BEGIN
  UPDATE user_export_requests
  SET
    status = 'ready',
    completed_at = NOW()
  WHERE download_token = p_download_token
  AND status = 'confirmed'
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função: registrar download
CREATE OR REPLACE FUNCTION record_export_download(
  p_download_token TEXT
) RETURNS user_export_requests AS $$
DECLARE
  v_result user_export_requests;
BEGIN
  UPDATE user_export_requests
  SET download_count = download_count + 1
  WHERE download_token = p_download_token
  AND status = 'ready'
  AND download_count < max_downloads
  AND expires_at > NOW()
  RETURNING * INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Token not found, already expired, or max downloads reached';
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função: marcar como expirado
CREATE OR REPLACE FUNCTION expire_export_request(
  p_download_token TEXT
) RETURNS user_export_requests AS $$
DECLARE
  v_result user_export_requests;
BEGIN
  UPDATE user_export_requests
  SET status = 'expired'
  WHERE download_token = p_download_token
  AND status IN ('ready', 'confirmed')
  AND expires_at <= NOW()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função: purge de exports expirados (job automático)
CREATE OR REPLACE FUNCTION purge_expired_exports()
RETURNS TABLE(purged_count INT, duration_ms INT) AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_purged_count INT;
BEGIN
  v_start_time := NOW();

  -- Marcar como expired se ainda não estão
  UPDATE user_export_requests
  SET status = 'expired'
  WHERE status IN ('ready', 'confirmed')
  AND expires_at <= NOW();

  -- Purge: marcar expired como purged
  UPDATE user_export_requests
  SET
    status = 'purged',
    purged_at = NOW()
  WHERE status = 'expired'
  AND purged_at IS NULL;

  GET DIAGNOSTICS v_purged_count = ROW_COUNT;

  RETURN QUERY SELECT v_purged_count, EXTRACT(EPOCH FROM (NOW() - v_start_time))::INT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função: obter status do export
CREATE OR REPLACE FUNCTION get_export_status(p_user_id UUID)
RETURNS TABLE(
  has_pending_request BOOLEAN,
  status TEXT,
  expires_at TIMESTAMPTZ,
  download_count INT,
  max_downloads INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    EXISTS(
      SELECT 1 FROM user_export_requests
      WHERE user_id = p_user_id
      AND status NOT IN ('expired', 'purged', 'failed')
    ) AS has_pending_request,
    (SELECT status::TEXT FROM user_export_requests
     WHERE user_id = p_user_id
     AND status NOT IN ('expired', 'purged', 'failed')
     ORDER BY created_at DESC LIMIT 1) AS status,
    (SELECT expires_at FROM user_export_requests
     WHERE user_id = p_user_id
     AND status NOT IN ('expired', 'purged', 'failed')
     ORDER BY created_at DESC LIMIT 1) AS expires_at,
    (SELECT download_count FROM user_export_requests
     WHERE user_id = p_user_id
     AND status NOT IN ('expired', 'purged', 'failed')
     ORDER BY created_at DESC LIMIT 1) AS download_count,
    (SELECT max_downloads FROM user_export_requests
     WHERE user_id = p_user_id
     AND status NOT IN ('expired', 'purged', 'failed')
     ORDER BY created_at DESC LIMIT 1) AS max_downloads;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função: sumário de exportações (compliance)
CREATE OR REPLACE FUNCTION get_export_summary()
RETURNS TABLE(
  total_exports INT,
  exports_completed INT,
  exports_expired INT,
  exports_purged INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INT AS total_exports,
    COUNT(*) FILTER (WHERE status = 'ready')::INT AS exports_completed,
    COUNT(*) FILTER (WHERE status = 'expired')::INT AS exports_expired,
    COUNT(*) FILTER (WHERE status = 'purged')::INT AS exports_purged;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE user_export_requests IS
  'LGPD Art. 18 — Requisições de acesso aos dados do titular. Lifecycle: requested → confirmed → processing → ready → (downloaded) → expired → purged';
COMMENT ON COLUMN user_export_requests.download_token IS
  'Token seguro e único para download do PDF. Nunca revela user_id.';
COMMENT ON COLUMN user_export_requests.expires_at IS
  'PDF expira após 48h. Downloads não funcionam após este timestamp.';
COMMENT ON COLUMN user_export_requests.max_downloads IS
  'Máximo 3 downloads por export para evitar abuse.';
