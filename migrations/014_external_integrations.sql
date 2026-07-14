-- External connection state is tenant-scoped. Browser clients may read their own
-- status, but credentials and connection state transitions remain server-only.

CREATE TABLE IF NOT EXISTS public.clinic_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  connected_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, integration_id)
);

ALTER TABLE public.clinic_integrations
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS connected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.clinic_integrations
  DROP CONSTRAINT IF EXISTS clinic_integrations_status_check;
ALTER TABLE public.clinic_integrations
  ADD CONSTRAINT clinic_integrations_status_check
  CHECK (status IN ('pending', 'connected', 'disabled', 'failed'));

ALTER TABLE public.clinic_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinic_integrations_select ON public.clinic_integrations;
CREATE POLICY clinic_integrations_select ON public.clinic_integrations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.clinic_id = clinic_integrations.clinic_id
        AND user_roles.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS clinic_integrations_manage ON public.clinic_integrations;

CREATE INDEX IF NOT EXISTS clinic_integrations_clinic_status_idx
  ON public.clinic_integrations (clinic_id, status);

CREATE TABLE IF NOT EXISTS public.wazzup_connections (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  api_key_ciphertext text,
  api_key_iv text,
  api_key_tag text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_tag text,
  connection_mode text NOT NULL DEFAULT 'oauth',
  access_token_expires_at timestamptz,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wazzup_connections
  ADD COLUMN IF NOT EXISTS refresh_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS refresh_token_iv text,
  ADD COLUMN IF NOT EXISTS refresh_token_tag text,
  ADD COLUMN IF NOT EXISTS connection_mode text NOT NULL DEFAULT 'oauth',
  ADD COLUMN IF NOT EXISTS access_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.wazzup_connections ENABLE ROW LEVEL SECURITY;
-- No browser policy: server functions are the only reader/writer of credentials.

CREATE TABLE IF NOT EXISTS public.integration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'in_review', 'approved', 'rejected', 'cancelled')),
  customer_note text,
  admin_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, integration_id)
);

ALTER TABLE public.integration_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integration_requests_select_members ON public.integration_requests;
CREATE POLICY integration_requests_select_members ON public.integration_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.clinic_id = integration_requests.clinic_id
        AND user_roles.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS integration_requests_create_members ON public.integration_requests;
CREATE POLICY integration_requests_create_members ON public.integration_requests
  FOR INSERT WITH CHECK (
    requested_by = auth.uid()
    AND status = 'requested'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.clinic_id = integration_requests.clinic_id
        AND user_roles.user_id = auth.uid()
        AND user_roles.role IN ('owner', 'manager')
    )
  );
