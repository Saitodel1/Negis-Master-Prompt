-- Allow organisation owners and managers to enable or disable the same
-- workspace sections that are offered during onboarding.

CREATE OR REPLACE FUNCTION public.negis_set_workspace_module_enabled(
  target_clinic_id uuid,
  target_module_key text,
  target_enabled boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_status text := CASE WHEN target_enabled THEN 'active' ELSE 'disabled' END;
  active_selection jsonb;
BEGIN
  IF NOT public.negis_is_clinic_manager(target_clinic_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF target_module_key <> ALL (ARRAY['booking', 'reception', 'chat', 'ads', 'reports', 'automations'])
     OR NOT EXISTS (
       SELECT 1
       FROM public.module_catalog
       WHERE module_key = target_module_key
         AND is_active = true
         AND is_core = false
     ) THEN
    RAISE EXCEPTION 'module is not available for workspace settings';
  END IF;

  INSERT INTO public.clinic_modules (
    clinic_id, module_key, status, source, activated_at, updated_at
  ) VALUES (
    target_clinic_id,
    target_module_key,
    next_status,
    'admin',
    CASE WHEN target_enabled THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (clinic_id, module_key) DO UPDATE SET
    status = next_status,
    source = 'admin',
    activated_at = CASE
      WHEN target_enabled THEN COALESCE(public.clinic_modules.activated_at, now())
      ELSE NULL
    END,
    updated_at = now();

  SELECT COALESCE(jsonb_agg(cm.module_key ORDER BY cm.module_key), '[]'::jsonb)
  INTO active_selection
  FROM public.clinic_modules cm
  WHERE cm.clinic_id = target_clinic_id
    AND cm.status = 'active'
    AND cm.module_key = ANY (ARRAY['booking', 'reception', 'chat', 'ads', 'reports', 'automations']);

  UPDATE public.clinic_onboarding_state
  SET selected_modules = active_selection,
      updated_at = now()
  WHERE clinic_id = target_clinic_id;

  RETURN next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.negis_set_workspace_module_enabled(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.negis_set_workspace_module_enabled(uuid, text, boolean) TO authenticated;
