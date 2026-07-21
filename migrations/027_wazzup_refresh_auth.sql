-- Use a dedicated shared secret for the cron -> Edge Function refresh call.
-- Required Vault secret: wazzup_refresh_secret.

CREATE OR REPLACE FUNCTION public.negis_request_wazzup_token_refresh()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_url text;
  refresh_secret text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret
    INTO project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  ORDER BY updated_at DESC
  LIMIT 1;

  SELECT decrypted_secret
    INTO refresh_secret
  FROM vault.decrypted_secrets
  WHERE name = 'wazzup_refresh_secret'
  ORDER BY updated_at DESC
  LIMIT 1;

  IF project_url IS NULL OR refresh_secret IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/wazzup-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || refresh_secret
    ),
    body := jsonb_build_object('limit', 100),
    timeout_milliseconds := 50000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.negis_request_wazzup_token_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.negis_request_wazzup_token_refresh() TO service_role;
