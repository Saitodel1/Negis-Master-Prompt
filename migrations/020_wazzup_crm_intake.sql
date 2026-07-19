-- Connect inbound Wazzup contacts to the universal CRM core.
-- Run after 019_deal_pipelines_and_client_deals.sql.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_normalized text;

CREATE OR REPLACE FUNCTION public.negis_normalize_phone_value(
  raw_phone text,
  workspace_country text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN digits = '' THEN NULL
    WHEN upper(COALESCE(workspace_country, '')) = 'KZ' AND length(digits) = 11 AND digits LIKE '8%'
      THEN '7' || substring(digits FROM 2)
    WHEN upper(COALESCE(workspace_country, '')) = 'KZ' AND length(digits) = 10
      THEN '7' || digits
    WHEN upper(COALESCE(workspace_country, '')) = 'KG' AND length(digits) = 10 AND digits LIKE '0%'
      THEN '996' || substring(digits FROM 2)
    WHEN upper(COALESCE(workspace_country, '')) = 'KG' AND length(digits) = 9
      THEN '996' || digits
    ELSE digits
  END
  FROM (SELECT regexp_replace(COALESCE(raw_phone, ''), '\D', '', 'g') AS digits) normalized;
$$;

UPDATE public.contacts contact
SET phone_normalized = public.negis_normalize_phone_value(contact.phone, workspace.country)
FROM public.clinics workspace
WHERE workspace.id = contact.clinic_id
  AND contact.phone_normalized IS DISTINCT FROM public.negis_normalize_phone_value(contact.phone, workspace.country);

CREATE INDEX IF NOT EXISTS contacts_clinic_phone_normalized_idx
  ON public.contacts (clinic_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE OR REPLACE FUNCTION public.negis_normalize_contact_phone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  workspace_country text;
BEGIN
  SELECT country INTO workspace_country
  FROM public.clinics
  WHERE id = NEW.clinic_id;

  NEW.phone_normalized := public.negis_normalize_phone_value(NEW.phone, workspace_country);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_normalize_contact_phone_before_write ON public.contacts;
CREATE TRIGGER negis_normalize_contact_phone_before_write
  BEFORE INSERT OR UPDATE OF phone ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.negis_normalize_contact_phone();

ALTER TABLE public.wz_contacts
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wz_contacts_contact_idx
  ON public.wz_contacts (clinic_id, contact_id);

CREATE INDEX IF NOT EXISTS wz_contacts_deal_idx
  ON public.wz_contacts (clinic_id, deal_id);

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
  crm_contact_id uuid;
  crm_deal_id uuid;
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

  -- Serialise one external identity/phone per workspace. This prevents two
  -- simultaneous webhook deliveries from creating two CRM contacts.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      target_clinic_id::text || ':' || COALESCE(normalized_phone, lower(COALESCE(target_chat_type, '')) || ':' || target_chat_id),
      0
    )
  );

  SELECT contact_id, deal_id
  INTO crm_contact_id, crm_deal_id
  FROM public.wz_contacts
  WHERE id = target_wz_contact_id
    AND clinic_id = target_clinic_id
  FOR UPDATE;

  IF crm_contact_id IS NULL AND normalized_phone IS NOT NULL THEN
    SELECT id
    INTO crm_contact_id
    FROM public.contacts
    WHERE clinic_id = target_clinic_id
      AND phone_normalized = normalized_phone
    ORDER BY created_at, id
    LIMIT 1;
  END IF;

  IF crm_contact_id IS NULL THEN
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
    RETURNING id INTO crm_contact_id;
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
    WHERE id = crm_contact_id
      AND clinic_id = target_clinic_id;
  END IF;

  -- A contact can have many deals over time, but only one open Wazzup intake
  -- deal is reused. Closed history is never overwritten.
  IF crm_deal_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.deals
    WHERE id = crm_deal_id
      AND clinic_id = target_clinic_id
      AND contact_id = crm_contact_id
      AND status = 'open'
  ) THEN
    SELECT id
    INTO crm_deal_id
    FROM public.deals
    WHERE clinic_id = target_clinic_id
      AND contact_id = crm_contact_id
      AND status = 'open'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1;
  END IF;

  IF crm_deal_id IS NULL THEN
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
        crm_contact_id,
        display_name || ' — Wazzup',
        default_pipeline_id,
        default_stage_id,
        0,
        COALESCE(default_currency, 'KZT'),
        'Wazzup'
      )
      RETURNING id INTO crm_deal_id;
      deal_created := true;
    END IF;
  END IF;

  UPDATE public.wz_contacts
  SET
    contact_id = crm_contact_id,
    deal_id = crm_deal_id,
    updated_at = now()
  WHERE id = target_wz_contact_id
    AND clinic_id = target_clinic_id;

  RETURN jsonb_build_object(
    'contact_id', crm_contact_id,
    'deal_id', crm_deal_id,
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

REVOKE ALL ON FUNCTION public.negis_normalize_contact_phone()
  FROM PUBLIC, anon, authenticated;
