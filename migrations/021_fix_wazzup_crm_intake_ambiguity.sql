-- Fix deployed Wazzup intake function: local variable names previously
-- collided with relation columns in PL/pgSQL and raised error 42702.

CREATE OR REPLACE FUNCTION public.negis_ingest_wazzup_contact(
  target_clinic_id uuid,
  target_wz_contact_id uuid,
  target_chat_type text,
  target_chat_id text,
  target_name text DEFAULT NULL,
  target_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_phone text;
  stored_phone text;
  display_name text;
  v_crm_contact_id uuid;
  v_crm_deal_id uuid;
  default_pipeline_id uuid;
  default_stage_id uuid;
  default_currency text;
  workspace_country text;
  contact_created boolean := false;
  deal_created boolean := false;
BEGIN
  IF target_clinic_id IS NULL OR target_wz_contact_id IS NULL OR NULLIF(trim(target_chat_id), '') IS NULL THEN
    RAISE EXCEPTION 'workspace, Wazzup contact and chat id are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.wz_contacts
    WHERE id = target_wz_contact_id
      AND clinic_id = target_clinic_id
  ) THEN
    RAISE EXCEPTION 'Wazzup contact does not belong to this workspace';
  END IF;

  SELECT country INTO workspace_country
  FROM public.clinics
  WHERE id = target_clinic_id;

  stored_phone := NULLIF(trim(target_phone), '');
  IF stored_phone IS NULL AND lower(COALESCE(target_chat_type, '')) IN ('whatsapp', 'whatsgroup') THEN
    stored_phone := NULLIF(trim(target_chat_id), '');
  END IF;

  normalized_phone := public.negis_normalize_phone_value(stored_phone, workspace_country);
  IF normalized_phone IS NOT NULL AND length(normalized_phone) < 7 THEN
    normalized_phone := NULL;
  END IF;

  display_name := COALESCE(
    NULLIF(trim(target_name), ''),
    NULLIF(trim(target_phone), ''),
    NULLIF(trim(target_chat_id), ''),
    'Контакт Wazzup'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      target_clinic_id::text || ':' || COALESCE(normalized_phone, lower(COALESCE(target_chat_type, '')) || ':' || target_chat_id),
      0
    )
  );

  SELECT contact_id, deal_id
  INTO v_crm_contact_id, v_crm_deal_id
  FROM public.wz_contacts
  WHERE id = target_wz_contact_id
    AND clinic_id = target_clinic_id
  FOR UPDATE;

  IF v_crm_contact_id IS NULL AND normalized_phone IS NOT NULL THEN
    SELECT id
    INTO v_crm_contact_id
    FROM public.contacts
    WHERE clinic_id = target_clinic_id
      AND phone_normalized = normalized_phone
    ORDER BY created_at, id
    LIMIT 1;
  END IF;

  IF v_crm_contact_id IS NULL THEN
    INSERT INTO public.contacts (
      clinic_id,
      first_name,
      phone,
      phone_normalized,
      source
    )
    VALUES (
      target_clinic_id,
      display_name,
      stored_phone,
      normalized_phone,
      'Wazzup'
    )
    RETURNING id INTO v_crm_contact_id;
    contact_created := true;
  ELSE
    UPDATE public.contacts
    SET
      first_name = CASE
        WHEN NULLIF(trim(first_name), '') IS NULL
          OR first_name = 'Без имени'
          OR first_name = phone
        THEN display_name
        ELSE first_name
      END,
      phone = COALESCE(phone, stored_phone),
      phone_normalized = COALESCE(phone_normalized, normalized_phone),
      source = COALESCE(NULLIF(trim(source), ''), 'Wazzup'),
      updated_at = now()
    WHERE id = v_crm_contact_id
      AND clinic_id = target_clinic_id;
  END IF;

  IF v_crm_deal_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.deals
    WHERE id = v_crm_deal_id
      AND clinic_id = target_clinic_id
      AND contact_id = v_crm_contact_id
      AND status = 'open'
  ) THEN
    SELECT id
    INTO v_crm_deal_id
    FROM public.deals
    WHERE clinic_id = target_clinic_id
      AND contact_id = v_crm_contact_id
      AND status = 'open'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1;
  END IF;

  IF v_crm_deal_id IS NULL THEN
    SELECT id, currency
    INTO default_pipeline_id, default_currency
    FROM public.deal_pipelines
    WHERE clinic_id = target_clinic_id
      AND is_active = true
    ORDER BY is_default DESC, sort_order, created_at
    LIMIT 1;

    SELECT id
    INTO default_stage_id
    FROM public.deal_stages
    WHERE clinic_id = target_clinic_id
      AND pipeline_id = default_pipeline_id
      AND is_active = true
      AND outcome = 'open'
    ORDER BY sort_order, created_at
    LIMIT 1;

    IF default_pipeline_id IS NOT NULL AND default_stage_id IS NOT NULL THEN
      INSERT INTO public.deals (
        clinic_id,
        contact_id,
        title,
        pipeline_id,
        stage_id,
        amount,
        currency,
        source
      )
      VALUES (
        target_clinic_id,
        v_crm_contact_id,
        display_name || ' — Wazzup',
        default_pipeline_id,
        default_stage_id,
        0,
        COALESCE(default_currency, 'KZT'),
        'Wazzup'
      )
      RETURNING id INTO v_crm_deal_id;
      deal_created := true;
    END IF;
  END IF;

  UPDATE public.wz_contacts
  SET
    contact_id = v_crm_contact_id,
    deal_id = v_crm_deal_id,
    updated_at = now()
  WHERE id = target_wz_contact_id
    AND clinic_id = target_clinic_id;

  RETURN jsonb_build_object(
    'contact_id', v_crm_contact_id,
    'deal_id', v_crm_deal_id,
    'source', 'Wazzup',
    'contact_created', contact_created,
    'deal_created', deal_created,
    'duplicate_matched', NOT contact_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.negis_ingest_wazzup_contact(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.negis_ingest_wazzup_contact(uuid, uuid, text, text, text, text)
  TO service_role;
