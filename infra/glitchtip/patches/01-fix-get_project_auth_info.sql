-- GlitchTip 6.2.6 cria a função get_project_auth_info() declarando a coluna 4
-- (organization_id) como bigint, mas numa instalação nova em Postgres 17 as
-- colunas projects_project.organization_id e organizations_ext_organization.id
-- são integer. Resultado: erro 42804 ("structure of query does not match
-- function result type") em TODO ingest de evento -> HTTP 500 e nada é gravado.
--
-- Recria a função com o tipo certo (integer na coluna 4). Idempotente;
-- roda a cada `docker compose up` pelo serviço gt-patches.
DROP FUNCTION IF EXISTS get_project_auth_info(bigint, uuid);
CREATE FUNCTION public.get_project_auth_info(p_project_id bigint, p_sentry_key uuid)
 RETURNS TABLE(
   project_id bigint,
   project_scrub_ip_addresses boolean,
   project_event_throttle_rate smallint,
   organization_id integer,
   organization_is_accepting_events boolean,
   organization_event_throttle_rate smallint,
   organization_scrub_ip_addresses boolean,
   project_first_event timestamp with time zone,
   project_scrub_config jsonb
 )
 LANGUAGE plpgsql AS $function$
BEGIN
    RETURN QUERY
    SELECT "projects_project"."id",
           "projects_project"."scrub_ip_addresses",
           "projects_project"."event_throttle_rate",
           "projects_project"."organization_id",
           "organizations_ext_organization"."is_accepting_events",
           "organizations_ext_organization"."event_throttle_rate",
           "organizations_ext_organization"."scrub_ip_addresses",
           "projects_project"."first_event",
           "projects_project"."scrub_config"
    FROM "projects_project"
    INNER JOIN "projects_projectkey"
        ON ("projects_project"."id" = "projects_projectkey"."project_id")
    INNER JOIN "organizations_ext_organization"
        ON ("projects_project"."organization_id" = "organizations_ext_organization"."id")
    WHERE "projects_project"."id" = p_project_id
      AND "projects_projectkey"."public_key" = p_sentry_key;
END;
$function$;
