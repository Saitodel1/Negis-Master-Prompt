-- ============================================================
-- Negis 019: multiple deal pipelines and client-card deals.
-- Safe to run more than once in Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deal_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency IN ('KZT', 'KGS', 'USD')),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS deal_pipelines_one_default_idx
  ON public.deal_pipelines (clinic_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS deal_pipelines_clinic_sort_idx
  ON public.deal_pipelines (clinic_id, is_active, sort_order);

INSERT INTO public.deal_pipelines (clinic_id, code, name, currency, is_default, sort_order)
SELECT c.id, 'main', 'Основная воронка', CASE WHEN c.country = 'KG' THEN 'KGS' ELSE 'KZT' END, true, 10
FROM public.clinics c
ON CONFLICT (clinic_id, code) DO UPDATE SET
  currency = EXCLUDED.currency;

ALTER TABLE public.deal_stages ADD COLUMN IF NOT EXISTS pipeline_id uuid;

UPDATE public.deal_stages ds
SET pipeline_id = dp.id
FROM public.deal_pipelines dp
WHERE ds.pipeline_id IS NULL
  AND dp.clinic_id = ds.clinic_id
  AND dp.is_default = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_stages_pipeline_id_fkey'
      AND conrelid = 'public.deal_stages'::regclass
  ) THEN
    ALTER TABLE public.deal_stages
      ADD CONSTRAINT deal_stages_pipeline_id_fkey
      FOREIGN KEY (pipeline_id) REFERENCES public.deal_pipelines(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.deal_stages ALTER COLUMN pipeline_id SET NOT NULL;
ALTER TABLE public.deal_stages DROP CONSTRAINT IF EXISTS deal_stages_clinic_id_code_key;
DROP INDEX IF EXISTS public.deal_stages_clinic_id_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS deal_stages_pipeline_code_unique_idx
  ON public.deal_stages (pipeline_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS deal_stages_clinic_code_unique_idx
  ON public.deal_stages (clinic_id, code);
CREATE INDEX IF NOT EXISTS deal_stages_pipeline_sort_idx
  ON public.deal_stages (pipeline_id, is_active, sort_order);

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_id uuid;

UPDATE public.deals d
SET pipeline_id = ds.pipeline_id
FROM public.deal_stages ds
WHERE d.pipeline_id IS NULL
  AND ds.id = d.stage_id
  AND ds.clinic_id = d.clinic_id;

UPDATE public.deals d
SET pipeline_id = dp.id
FROM public.deal_pipelines dp
WHERE d.pipeline_id IS NULL
  AND dp.clinic_id = d.clinic_id
  AND dp.is_default = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_pipeline_id_fkey'
      AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_pipeline_id_fkey
      FOREIGN KEY (pipeline_id) REFERENCES public.deal_pipelines(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.deals ALTER COLUMN pipeline_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS deals_pipeline_stage_idx
  ON public.deals (pipeline_id, stage_id, status, updated_at DESC);

CREATE OR REPLACE FUNCTION public.negis_create_deal_pipeline(
  target_clinic_id uuid,
  target_name text,
  target_currency text DEFAULT 'KZT'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_pipeline_id uuid;
BEGIN
  IF NOT public.negis_is_clinic_manager(target_clinic_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF COALESCE(trim(target_name), '') = '' THEN
    RAISE EXCEPTION 'pipeline name is required';
  END IF;
  IF target_currency NOT IN ('KZT', 'KGS', 'USD') THEN
    RAISE EXCEPTION 'unsupported currency';
  END IF;

  INSERT INTO public.deal_pipelines
    (clinic_id, code, name, currency, is_default, sort_order)
  VALUES
    (target_clinic_id,
     'pipeline_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
     left(trim(target_name), 120), target_currency, false,
     COALESCE((SELECT max(sort_order) + 10 FROM public.deal_pipelines WHERE clinic_id = target_clinic_id), 10))
  RETURNING id INTO created_pipeline_id;

  INSERT INTO public.deal_stages
    (clinic_id, pipeline_id, code, name, probability, outcome, sort_order, color)
  VALUES
    (target_clinic_id, created_pipeline_id,
     'stage_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
     'Новый', 10, 'open', 10, '#DBEAFE'),
    (target_clinic_id, created_pipeline_id,
     'stage_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
     'Успех', 100, 'won', 20, '#BBF7D0');

  RETURN created_pipeline_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_replace_deal_pipeline(
  target_pipeline_id uuid,
  target_name text,
  stage_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_clinic_id uuid;
  stage_row jsonb;
  stage_position integer := 0;
  existing_stage_id uuid;
  kept_stage_ids uuid[] := ARRAY[]::uuid[];
  inserted_stage_id uuid;
BEGIN
  SELECT clinic_id INTO target_clinic_id
  FROM public.deal_pipelines
  WHERE id = target_pipeline_id AND is_active = true;

  IF target_clinic_id IS NULL OR NOT public.negis_is_clinic_manager(target_clinic_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF COALESCE(trim(target_name), '') = '' THEN
    RAISE EXCEPTION 'pipeline name is required';
  END IF;
  IF jsonb_typeof(stage_rows) <> 'array' OR jsonb_array_length(stage_rows) = 0 THEN
    RAISE EXCEPTION 'pipeline requires at least one stage';
  END IF;

  UPDATE public.deal_pipelines
  SET name = left(trim(target_name), 120), updated_at = now()
  WHERE id = target_pipeline_id;

  FOR stage_row IN SELECT value FROM jsonb_array_elements(stage_rows)
  LOOP
    stage_position := stage_position + 1;
    existing_stage_id := CASE
      WHEN COALESCE(stage_row->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (stage_row->>'id')::uuid
      ELSE NULL
    END;

    IF COALESCE(trim(stage_row->>'name'), '') = '' THEN
      RAISE EXCEPTION 'stage name is required';
    END IF;
    IF COALESCE(stage_row->>'outcome', '') NOT IN ('open', 'won', 'lost') THEN
      RAISE EXCEPTION 'invalid stage outcome';
    END IF;

    IF existing_stage_id IS NOT NULL THEN
      UPDATE public.deal_stages
      SET name = left(trim(stage_row->>'name'), 120),
          probability = GREATEST(0, LEAST(100, COALESCE((stage_row->>'probability')::smallint, 0))),
          outcome = stage_row->>'outcome',
          color = COALESCE(NULLIF(stage_row->>'color', ''), '#DBEAFE'),
          sort_order = stage_position * 10,
          is_active = true,
          updated_at = now()
      WHERE id = existing_stage_id
        AND pipeline_id = target_pipeline_id
        AND clinic_id = target_clinic_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'stage does not belong to pipeline'; END IF;
      kept_stage_ids := array_append(kept_stage_ids, existing_stage_id);
    ELSE
      INSERT INTO public.deal_stages
        (clinic_id, pipeline_id, code, name, probability, outcome, sort_order, color, is_active)
      VALUES
        (target_clinic_id, target_pipeline_id,
         'stage_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
         left(trim(stage_row->>'name'), 120),
         GREATEST(0, LEAST(100, COALESCE((stage_row->>'probability')::smallint, 0))),
         stage_row->>'outcome', stage_position * 10,
         COALESCE(NULLIF(stage_row->>'color', ''), '#DBEAFE'), true)
      RETURNING id INTO inserted_stage_id;
      kept_stage_ids := array_append(kept_stage_ids, inserted_stage_id);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.deals d
    JOIN public.deal_stages ds ON ds.id = d.stage_id
    WHERE ds.pipeline_id = target_pipeline_id
      AND NOT (ds.id = ANY(kept_stage_ids))
  ) THEN
    RAISE EXCEPTION 'move deals from removed stages first';
  END IF;

  UPDATE public.deal_stages
  SET is_active = false, updated_at = now()
  WHERE pipeline_id = target_pipeline_id
    AND NOT (id = ANY(kept_stage_ids));

  RETURN jsonb_build_object('pipeline_id', target_pipeline_id, 'stage_count', array_length(kept_stage_ids, 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_seed_deal_stages(target_clinic_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_pipeline_id uuid;
  target_currency text;
BEGIN
  SELECT CASE WHEN country = 'KG' THEN 'KGS' ELSE 'KZT' END
  INTO target_currency
  FROM public.clinics
  WHERE id = target_clinic_id;

  INSERT INTO public.deal_pipelines (clinic_id, code, name, currency, is_default, sort_order)
  VALUES (target_clinic_id, 'main', 'Основная воронка', COALESCE(target_currency, 'KZT'), true, 10)
  ON CONFLICT (clinic_id, code) DO UPDATE SET currency = EXCLUDED.currency
  RETURNING id INTO target_pipeline_id;

  INSERT INTO public.deal_stages
    (clinic_id, pipeline_id, code, name, probability, outcome, sort_order, color)
  VALUES
    (target_clinic_id, target_pipeline_id, 'new', 'Новый', 10, 'open', 10, '#DBEAFE'),
    (target_clinic_id, target_pipeline_id, 'qualification', 'Квалификация', 30, 'open', 20, '#E0E7FF'),
    (target_clinic_id, target_pipeline_id, 'proposal', 'Предложение отправлено', 60, 'open', 30, '#EDE9FE'),
    (target_clinic_id, target_pipeline_id, 'negotiation', 'Согласование', 80, 'open', 40, '#FEF3C7'),
    (target_clinic_id, target_pipeline_id, 'payment', 'Оплата', 95, 'open', 50, '#D1FAE5'),
    (target_clinic_id, target_pipeline_id, 'success', 'Успех', 100, 'won', 60, '#BBF7D0'),
    (target_clinic_id, target_pipeline_id, 'lost', 'Отказ', 0, 'lost', 70, '#FEE2E2')
  ON CONFLICT (pipeline_id, code) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_apply_deal_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_stage public.deal_stages%ROWTYPE;
  selected_pipeline_id uuid;
BEGIN
  selected_pipeline_id := NEW.pipeline_id;

  IF selected_pipeline_id IS NULL AND NEW.stage_id IS NOT NULL THEN
    SELECT pipeline_id INTO selected_pipeline_id
    FROM public.deal_stages
    WHERE id = NEW.stage_id AND clinic_id = NEW.clinic_id;
  END IF;

  IF selected_pipeline_id IS NULL THEN
    SELECT id INTO selected_pipeline_id
    FROM public.deal_pipelines
    WHERE clinic_id = NEW.clinic_id AND is_default = true AND is_active = true
    LIMIT 1;
  END IF;

  IF NEW.stage_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN
    SELECT * INTO selected_stage
    FROM public.deal_stages
    WHERE id = NEW.stage_id
      AND clinic_id = NEW.clinic_id
      AND pipeline_id = selected_pipeline_id
      AND is_active = true;
  ELSE
    SELECT * INTO selected_stage
    FROM public.deal_stages
    WHERE clinic_id = NEW.clinic_id
      AND pipeline_id = selected_pipeline_id
      AND code = NEW.stage
      AND is_active = true;
  END IF;

  -- Automation rules address stages by their internal code. Codes are unique
  -- inside a workspace, so an explicit stage change may also switch pipelines.
  IF selected_stage.id IS NULL
     AND TG_OP = 'UPDATE'
     AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    SELECT * INTO selected_stage
    FROM public.deal_stages
    WHERE clinic_id = NEW.clinic_id
      AND code = NEW.stage
      AND is_active = true;
  END IF;

  IF selected_stage.id IS NULL
     AND TG_OP = 'INSERT'
     AND NEW.stage_id IS NULL
     AND COALESCE(NEW.stage, '') = '' THEN
    SELECT * INTO selected_stage
    FROM public.deal_stages
    WHERE clinic_id = NEW.clinic_id
      AND pipeline_id = selected_pipeline_id
      AND is_active = true
    ORDER BY sort_order, created_at
    LIMIT 1;
  END IF;

  IF selected_stage.id IS NULL THEN
    RAISE EXCEPTION 'deal stage is not available for this pipeline';
  END IF;

  NEW.pipeline_id = selected_stage.pipeline_id;
  NEW.stage_id = selected_stage.id;
  NEW.stage = selected_stage.code;
  NEW.probability = selected_stage.probability;
  IF NEW.status <> 'cancelled' THEN
    NEW.status = selected_stage.outcome;
  END IF;

  IF NEW.status = 'won' THEN
    NEW.probability = 100;
    NEW.closed_at = COALESCE(NEW.closed_at, now());
  ELSIF NEW.status IN ('lost', 'cancelled') THEN
    NEW.probability = 0;
    NEW.closed_at = COALESCE(NEW.closed_at, now());
  ELSE
    NEW.closed_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_apply_deal_stage_before_write ON public.deals;
CREATE TRIGGER negis_apply_deal_stage_before_write
  BEFORE INSERT OR UPDATE OF pipeline_id, stage_id, stage, status
  ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.negis_apply_deal_stage();

CREATE TABLE IF NOT EXISTS public.deal_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES public.deal_pipelines(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES public.deal_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES public.deal_stages(id) ON DELETE RESTRICT,
  changed_by uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_stage_events_deal_time_idx
  ON public.deal_stage_events (deal_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.negis_record_deal_stage_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO public.deal_stage_events
      (clinic_id, deal_id, pipeline_id, from_stage_id, to_stage_id, changed_by)
    VALUES
      (NEW.clinic_id, NEW.id, NEW.pipeline_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END, NEW.stage_id, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_record_deal_stage_event_after_write ON public.deals;
CREATE TRIGGER negis_record_deal_stage_event_after_write
  AFTER INSERT OR UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.negis_record_deal_stage_event();

DROP TRIGGER IF EXISTS negis_touch_deal_pipelines ON public.deal_pipelines;
CREATE TRIGGER negis_touch_deal_pipelines
  BEFORE UPDATE ON public.deal_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.negis_touch_updated_at();

ALTER TABLE public.deal_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_pipelines_read ON public.deal_pipelines;
CREATE POLICY deal_pipelines_read ON public.deal_pipelines
  FOR SELECT USING (public.negis_has_workspace_permission(clinic_id, 'crm'));
DROP POLICY IF EXISTS deal_pipelines_manage ON public.deal_pipelines;
CREATE POLICY deal_pipelines_manage ON public.deal_pipelines
  FOR ALL USING (public.negis_is_clinic_manager(clinic_id))
  WITH CHECK (public.negis_is_clinic_manager(clinic_id));

ALTER TABLE public.deal_stage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_stage_events_read ON public.deal_stage_events;
CREATE POLICY deal_stage_events_read ON public.deal_stage_events
  FOR SELECT USING (public.negis_has_workspace_permission(clinic_id, 'crm'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_pipelines TO authenticated;
GRANT SELECT ON public.deal_stage_events TO authenticated;
REVOKE ALL ON FUNCTION public.negis_replace_deal_pipeline(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.negis_replace_deal_pipeline(uuid, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.negis_create_deal_pipeline(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.negis_create_deal_pipeline(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.negis_record_deal_stage_event() FROM PUBLIC, anon, authenticated;
