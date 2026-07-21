-- Tenant-scoped Wazzup OAuth lifecycle.
-- Credentials remain server-only; refresh leases prevent concurrent token rotation.

ALTER TABLE public.wazzup_connections
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_lease_id uuid,
  ADD COLUMN IF NOT EXISTS last_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_error text,
  ADD COLUMN IF NOT EXISTS webhook_subscriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS channel_sync_at timestamptz;

CREATE INDEX IF NOT EXISTS wazzup_connections_access_expiry_idx
  ON public.wazzup_connections (access_token_expires_at);

CREATE OR REPLACE FUNCTION public.negis_claim_wazzup_refresh(
  target_clinic_id uuid DEFAULT NULL,
  lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
  clinic_id uuid,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_tag text,
  refresh_token_expires_at timestamptz,
  refresh_lease_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_clinic_id uuid;
  claimed_lease_id uuid := gen_random_uuid();
BEGIN
  SELECT wc.clinic_id
    INTO claimed_clinic_id
  FROM public.wazzup_connections wc
  WHERE (target_clinic_id IS NULL OR wc.clinic_id = target_clinic_id)
    AND wc.connection_mode = 'oauth'
    AND wc.refresh_token_ciphertext IS NOT NULL
    AND wc.refresh_token_iv IS NOT NULL
    AND wc.refresh_token_tag IS NOT NULL
    AND (wc.refresh_token_expires_at IS NULL OR wc.refresh_token_expires_at > now())
    AND (wc.access_token_expires_at IS NULL OR wc.access_token_expires_at <= now() + interval '3 minutes')
    AND (wc.refresh_lease_until IS NULL OR wc.refresh_lease_until < now())
  ORDER BY wc.access_token_expires_at NULLS FIRST
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_clinic_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.wazzup_connections wc
  SET refresh_lease_id = claimed_lease_id,
      refresh_lease_until = now() + make_interval(secs => greatest(15, least(lease_seconds, 180))),
      updated_at = now()
  WHERE wc.clinic_id = claimed_clinic_id
  RETURNING
    wc.clinic_id,
    wc.refresh_token_ciphertext,
    wc.refresh_token_iv,
    wc.refresh_token_tag,
    wc.refresh_token_expires_at,
    wc.refresh_lease_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_complete_wazzup_refresh(
  target_clinic_id uuid,
  target_lease_id uuid,
  next_access_token_ciphertext text,
  next_access_token_iv text,
  next_access_token_tag text,
  next_access_token_expires_at timestamptz,
  next_refresh_token_ciphertext text DEFAULT NULL,
  next_refresh_token_iv text DEFAULT NULL,
  next_refresh_token_tag text DEFAULT NULL,
  next_refresh_token_expires_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.wazzup_connections wc
  SET api_key_ciphertext = next_access_token_ciphertext,
      api_key_iv = next_access_token_iv,
      api_key_tag = next_access_token_tag,
      access_token_expires_at = next_access_token_expires_at,
      refresh_token_ciphertext = COALESCE(next_refresh_token_ciphertext, wc.refresh_token_ciphertext),
      refresh_token_iv = COALESCE(next_refresh_token_iv, wc.refresh_token_iv),
      refresh_token_tag = COALESCE(next_refresh_token_tag, wc.refresh_token_tag),
      refresh_token_expires_at = COALESCE(next_refresh_token_expires_at, wc.refresh_token_expires_at),
      refresh_lease_id = NULL,
      refresh_lease_until = NULL,
      last_refresh_at = now(),
      last_refresh_error = NULL,
      updated_at = now()
  WHERE wc.clinic_id = target_clinic_id
    AND wc.refresh_lease_id = target_lease_id;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_fail_wazzup_refresh(
  target_clinic_id uuid,
  target_lease_id uuid,
  failure_message text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.wazzup_connections wc
  SET refresh_lease_id = NULL,
      refresh_lease_until = NULL,
      last_refresh_error = left(failure_message, 1000),
      updated_at = now()
  WHERE wc.clinic_id = target_clinic_id
    AND wc.refresh_lease_id = target_lease_id;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.negis_claim_wazzup_refresh(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negis_complete_wazzup_refresh(uuid, uuid, text, text, text, timestamptz, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negis_fail_wazzup_refresh(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.negis_claim_wazzup_refresh(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.negis_complete_wazzup_refresh(uuid, uuid, text, text, text, timestamptz, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.negis_fail_wazzup_refresh(uuid, uuid, text) TO service_role;
