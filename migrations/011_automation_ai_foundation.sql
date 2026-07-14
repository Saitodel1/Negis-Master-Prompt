-- ============================================================
-- Negis: automation and AI foundation
-- Safe to run more than once in Supabase SQL Editor.
-- Existing field name clinic_id means an organisation/workspace.
-- ============================================================

-- 1. Probability for the sales funnel.
ALTER TABLE public.lead_statuses
  ADD COLUMN IF NOT EXISTS probability smallint NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_statuses_probability_check'
      AND conrelid = 'public.lead_statuses'::regclass
  ) THEN
    ALTER TABLE public.lead_statuses
      ADD CONSTRAINT lead_statuses_probability_check
      CHECK (probability >= 0 AND probability <= 100);
  END IF;
END
$$;

-- 2. Automation rules and their execution log.
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  trigger_type text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_rules_clinic_rule_key_unique UNIQUE (clinic_id, rule_key)
);

CREATE INDEX IF NOT EXISTS automation_rules_clinic_enabled_idx
  ON public.automation_rules (clinic_id, is_enabled, trigger_type);

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  trigger_entity_type text,
  trigger_entity_id uuid,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'skipped', 'failed')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_runs_clinic_created_idx
  ON public.automation_runs (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS automation_runs_rule_status_idx
  ON public.automation_runs (rule_id, status, created_at DESC);

-- 3. One connection per organisation and external account.
-- No token is stored in this table.
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  provider text NOT NULL,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'not_connected'
    CHECK (status IN ('not_connected', 'pending', 'connected', 'error', 'disabled')),
  external_account_id text NOT NULL DEFAULT '',
  display_name text,
  country_code text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  last_error text,
  connected_by uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_connections_unique_account
    UNIQUE (clinic_id, provider, external_account_id)
);

CREATE INDEX IF NOT EXISTS integration_connections_clinic_category_idx
  ON public.integration_connections (clinic_id, category, status);

-- Server-only encrypted tokens or vault references.
-- RLS is enabled below and no client policy is added intentionally.
CREATE TABLE IF NOT EXISTS public.integration_secrets (
  integration_connection_id uuid PRIMARY KEY
    REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  key_version text NOT NULL DEFAULT 'v1',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Customer activity, reporting data and funnel history.
CREATE TABLE IF NOT EXISTS public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  actor_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_lead_time_idx
  ON public.activity_events (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_clinic_type_idx
  ON public.activity_events (clinic_id, event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  metric_key text NOT NULL,
  dimension_key text NOT NULL DEFAULT 'all',
  dimension_value text NOT NULL DEFAULT 'all',
  value_numeric numeric(16, 2) NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_metrics_unique_dimension
    UNIQUE (clinic_id, metric_date, metric_key, dimension_key, dimension_value)
);

CREATE INDEX IF NOT EXISTS daily_metrics_clinic_date_idx
  ON public.daily_metrics (clinic_id, metric_date DESC);

CREATE TABLE IF NOT EXISTS public.funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pipeline text NOT NULL DEFAULT 'sales',
  from_status_id uuid REFERENCES public.lead_statuses(id) ON DELETE SET NULL,
  to_status_id uuid REFERENCES public.lead_statuses(id) ON DELETE SET NULL,
  probability smallint NOT NULL DEFAULT 0
    CHECK (probability >= 0 AND probability <= 100),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_events_lead_time_idx
  ON public.funnel_events (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS funnel_events_clinic_pipeline_time_idx
  ON public.funnel_events (clinic_id, pipeline, occurred_at DESC);

-- 5. AI jobs are an audit trail, never an auto-execution queue.
CREATE TABLE IF NOT EXISTS public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'deepseek')),
  model text,
  job_type text NOT NULL CHECK (job_type IN (
    'lead_summary',
    'next_best_action',
    'conversation_reply',
    'call_analysis',
    'automation_recommendation'
  )),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',
    'running',
    'awaiting_confirmation',
    'confirmed',
    'rejected',
    'failed'
  )),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  confirmed_by uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_jobs_clinic_created_idx
  ON public.ai_jobs (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_jobs_lead_created_idx
  ON public.ai_jobs (lead_id, created_at DESC);

-- 6. Funnel and activity history after a lead status change.
CREATE OR REPLACE FUNCTION public.negis_track_lead_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_probability smallint := 0;
  next_status_name text := NULL;
BEGIN
  SELECT probability, name
  INTO next_probability, next_status_name
  FROM public.lead_statuses
  WHERE id = NEW.status_id;

  INSERT INTO public.funnel_events (
    clinic_id,
    lead_id,
    pipeline,
    from_status_id,
    to_status_id,
    probability
  ) VALUES (
    NEW.clinic_id,
    NEW.id,
    COALESCE(NEW.pipeline, 'sales'),
    OLD.status_id,
    NEW.status_id,
    COALESCE(next_probability, 0)
  );

  INSERT INTO public.activity_events (
    clinic_id,
    lead_id,
    event_type,
    title,
    payload
  ) VALUES (
    NEW.clinic_id,
    NEW.id,
    'lead_status_changed',
    'Status changed',
    jsonb_build_object(
      'from_status_id', OLD.status_id,
      'to_status_id', NEW.status_id,
      'to_status_name', next_status_name,
      'probability', COALESCE(next_probability, 0)
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_lead_status_transition ON public.leads;
CREATE TRIGGER negis_lead_status_transition
  AFTER UPDATE OF status_id ON public.leads
  FOR EACH ROW
  WHEN (OLD.status_id IS DISTINCT FROM NEW.status_id)
  EXECUTE FUNCTION public.negis_track_lead_status_transition();

-- 7. Default rules for present and future organisations.
CREATE OR REPLACE FUNCTION public.negis_seed_default_automation_rules(target_clinic_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.automation_rules (
    clinic_id,
    rule_key,
    name,
    description,
    trigger_type,
    conditions,
    actions
  )
  VALUES
    (
      target_clinic_id,
      'lead_no_response_15m',
      'Lead without response for 15 minutes',
      'Escalate a new lead that has no activity after 15 minutes.',
      'lead.created',
      '{"after_minutes":15}'::jsonb,
      '[{"type":"notify_assignee"},{"type":"notify_manager"}]'::jsonb
    ),
    (
      target_clinic_id,
      'task_overdue',
      'Overdue task',
      'Notify the assignee and manager when a task passes its due time.',
      'task.overdue',
      '{}'::jsonb,
      '[{"type":"notify_assignee"},{"type":"notify_manager"}]'::jsonb
    ),
    (
      target_clinic_id,
      'daily_summary',
      'Daily operations summary',
      'Prepare daily leads, bookings, visits, payments and overdue tasks.',
      'schedule.daily',
      '{"hour":20,"timezone":"clinic"}'::jsonb,
      '[{"type":"build_report"},{"type":"send_email"}]'::jsonb
    ),
    (
      target_clinic_id,
      'agent_overload',
      'Employee overload',
      'Warn a manager when an employee has too many unprocessed leads.',
      'lead.assigned',
      '{"open_leads_gte":25}'::jsonb,
      '[{"type":"notify_manager"}]'::jsonb
    )
  ON CONFLICT (clinic_id, rule_key) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.negis_seed_default_automation_rules_for_clinic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.negis_seed_default_automation_rules(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_seed_automation_rules_after_clinic_create ON public.clinics;
CREATE TRIGGER negis_seed_automation_rules_after_clinic_create
  AFTER INSERT ON public.clinics
  FOR EACH ROW
  EXECUTE FUNCTION public.negis_seed_default_automation_rules_for_clinic();

SELECT public.negis_seed_default_automation_rules(id)
FROM public.clinics;

-- 8. RLS. Owners and managers can maintain rules/connections;
-- members can read operational history for their organisation.
CREATE OR REPLACE FUNCTION public.negis_is_clinic_member(target_clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND clinic_id = target_clinic_id
  );
$$;

CREATE OR REPLACE FUNCTION public.negis_is_clinic_manager(target_clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND clinic_id = target_clinic_id
      AND role IN ('owner', 'manager')
  );
$$;

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_rules_read ON public.automation_rules;
CREATE POLICY automation_rules_read ON public.automation_rules
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));
DROP POLICY IF EXISTS automation_rules_manage ON public.automation_rules;
CREATE POLICY automation_rules_manage ON public.automation_rules
  FOR ALL
  USING (public.negis_is_clinic_manager(clinic_id))
  WITH CHECK (public.negis_is_clinic_manager(clinic_id));

DROP POLICY IF EXISTS automation_runs_read ON public.automation_runs;
CREATE POLICY automation_runs_read ON public.automation_runs
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));

DROP POLICY IF EXISTS integration_connections_read ON public.integration_connections;
CREATE POLICY integration_connections_read ON public.integration_connections
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));
DROP POLICY IF EXISTS integration_connections_manage ON public.integration_connections;
CREATE POLICY integration_connections_manage ON public.integration_connections
  FOR ALL
  USING (public.negis_is_clinic_manager(clinic_id))
  WITH CHECK (public.negis_is_clinic_manager(clinic_id));

DROP POLICY IF EXISTS activity_events_read ON public.activity_events;
CREATE POLICY activity_events_read ON public.activity_events
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));
DROP POLICY IF EXISTS activity_events_insert ON public.activity_events;
CREATE POLICY activity_events_insert ON public.activity_events
  FOR INSERT WITH CHECK (public.negis_is_clinic_member(clinic_id));

DROP POLICY IF EXISTS daily_metrics_read ON public.daily_metrics;
CREATE POLICY daily_metrics_read ON public.daily_metrics
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));

DROP POLICY IF EXISTS funnel_events_read ON public.funnel_events;
CREATE POLICY funnel_events_read ON public.funnel_events
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));

DROP POLICY IF EXISTS ai_jobs_read ON public.ai_jobs;
CREATE POLICY ai_jobs_read ON public.ai_jobs
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));

-- integration_secrets deliberately has no authenticated policy.
-- Server code with SUPABASE_SERVICE_ROLE_KEY bypasses RLS to write runs,
-- metrics, secrets and AI jobs.
