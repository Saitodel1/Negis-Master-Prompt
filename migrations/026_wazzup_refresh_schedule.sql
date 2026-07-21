-- Refresh tenant Wazzup access tokens inside the provider's final three-minute window.
-- Required Vault secrets: project_url and service_role_key.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.negis_request_wazzup_token_refresh()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_url text;
  service_role_key text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret
    INTO project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  ORDER BY updated_at DESC
  LIMIT 1;

  SELECT decrypted_secret
    INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  ORDER BY updated_at DESC
  LIMIT 1;

  IF project_url IS NULL OR service_role_key IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/wazzup-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', service_role_key,
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('limit', 100),
    timeout_milliseconds := 50000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.negis_request_wazzup_token_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.negis_request_wazzup_token_refresh() TO service_role;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid
    INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'negis-wazzup-token-refresh'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'negis-wazzup-token-refresh',
    '* * * * *',
    'SELECT public.negis_request_wazzup_token_refresh();'
  );
END;
$$;
