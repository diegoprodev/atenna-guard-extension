-- FASE 10.9.6 — LGPD funcional (corrige get_export_status)
--
-- Contexto: "Solicitar relatório" e "Excluir dados" davam 503 em produção e o
-- frontend engolia em silêncio. Diagnóstico pelos logs do backend (GlitchTip):
--
--   1. get_export_status → 42702 "column reference \"status\" is ambiguous"
--      A coluna OUT `status` do RETURNS TABLE colide com
--      user_export_requests.status dentro do corpo da função.
--
--   2. initiate_account_deletion → PGRST202 "function not found"
--      A migration 20260507_account_deletion_governance.sql nunca foi aplicada
--      neste banco (mesma vítima da migração de infra de set/2026 que sumiu com
--      /auth/admin-login). >>> RODAR 20260507_account_deletion_governance.sql
--      ANTES OU DEPOIS deste arquivo. Ela é idempotente.
--
-- Este arquivo só corrige a função de status. Idempotente.

CREATE OR REPLACE FUNCTION public.get_export_status(p_user_id uuid)
 RETURNS TABLE(has_pending_request boolean, status text, expires_at timestamptz,
               download_count integer, max_downloads integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH active AS (
    SELECT r.status::text     AS r_status,
           r.expires_at       AS r_expires_at,
           r.download_count    AS r_download_count,
           r.max_downloads     AS r_max_downloads
    FROM user_export_requests r
    WHERE r.user_id = p_user_id
      AND r.status NOT IN ('expired', 'purged', 'failed')
    ORDER BY r.created_at DESC
    LIMIT 1
  )
  SELECT
    EXISTS(SELECT 1 FROM active),
    (SELECT r_status         FROM active),
    (SELECT r_expires_at     FROM active),
    (SELECT r_download_count  FROM active),
    (SELECT r_max_downloads   FROM active);
END;
$function$;

-- Limpa pedidos de export presos em 'requested' há mais de 1 dia (o e-mail de
-- confirmação expira em 24h, então esses nunca vão ser confirmados).
UPDATE public.user_export_requests
SET status = 'expired'
WHERE status = 'requested'
  AND created_at < now() - interval '1 day';
