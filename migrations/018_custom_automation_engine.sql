-- ============================================================
-- Negis 018: event-driven custom automation engine.
-- Requires migrations 010, 011, 012 and 017 plus pg_cron.
-- Safe to run more than once in Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  event_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, event_key)
);

CREATE INDEX IF NOT EXISTS automation_events_pending_idx
  ON public.automation_events (status, available_at, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_events_read ON public.automation_events;
CREATE POLICY automation_events_read ON public.automation_events
  FOR SELECT USING (public.negis_is_clinic_manager(clinic_id));

GRANT SELECT ON public.automation_events TO authenticated;

CREATE OR REPLACE FUNCTION public.negis_queue_automation_event(
  target_clinic_id uuid,
  target_event_type text,
  target_entity_type text,
  target_entity_id uuid,
  target_event_key text,
  target_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_id uuid;
BEGIN
  INSERT INTO public.automation_events (
    clinic_id, event_type, entity_type, entity_id, event_key, payload
  ) VALUES (
    target_clinic_id,
    target_event_type,
    target_entity_type,
    target_entity_id,
    target_event_key,
    COALESCE(target_payload, '{}'::jsonb)
  )
  ON CONFLICT (clinic_id, event_key) DO UPDATE SET
    payload = EXCLUDED.payload,
    available_at = LEAST(public.automation_events.available_at, now())
  RETURNING id INTO queued_id;

  RETURN queued_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_capture_automation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_payload jsonb;
  new_row jsonb;
  old_row jsonb := '{}'::jsonb;
  target_clinic_id uuid;
  target_entity_id uuid;
  new_stage text;
  old_stage text;
  new_status text;
  old_status text;
  should_queue boolean := false;
BEGIN
  -- This function is shared by tables with different row shapes. Reading
  -- optional fields through jsonb prevents PostgreSQL from resolving a field
  -- such as NEW.stage on a leads or contacts record.
  new_row := to_jsonb(NEW);
  IF TG_OP <> 'INSERT' THEN
    old_row := to_jsonb(OLD);
  END IF;

  target_clinic_id := NULLIF(new_row ->> 'clinic_id', '')::uuid;
  target_entity_id := NULLIF(new_row ->> 'id', '')::uuid;
  new_stage := new_row ->> 'stage';
  old_stage := old_row ->> 'stage';
  new_status := new_row ->> 'status';
  old_status := old_row ->> 'status';

  IF TG_TABLE_NAME = 'leads' AND TG_OP = 'INSERT' THEN
    event_payload := new_row || jsonb_build_object(
      'owner_id', new_row ->> 'assigned_to',
      'owner_agent_id', new_row ->> 'assigned_to'
    );
    PERFORM public.negis_queue_automation_event(
      target_clinic_id, 'lead.created', 'lead', target_entity_id,
      format('lead.created:%s', target_entity_id), event_payload
    );
  ELSIF TG_TABLE_NAME = 'contacts' AND TG_OP = 'INSERT' AND new_row ->> 'legacy_lead_id' IS NULL THEN
    event_payload := new_row || jsonb_build_object('owner_id', new_row ->> 'owner_agent_id');
    PERFORM public.negis_queue_automation_event(
      target_clinic_id, 'contact.created', 'contact', target_entity_id,
      format('contact.created:%s', target_entity_id), event_payload
    );
  ELSIF TG_TABLE_NAME = 'deals' AND TG_OP = 'UPDATE'
    AND (new_stage IS DISTINCT FROM old_stage OR new_status IS DISTINCT FROM old_status) THEN
    event_payload := new_row || jsonb_build_object(
      'owner_id', new_row ->> 'owner_agent_id',
      'old_stage', old_stage,
      'new_stage', new_stage,
      'old_status', old_status,
      'new_status', new_status
    );
    PERFORM public.negis_queue_automation_event(
      target_clinic_id, 'deal.stage_changed', 'deal', target_entity_id,
      format(
        'deal.stage_changed:%s:%s:%s:%s:%s:%s',
        target_entity_id, current_date, old_stage, new_stage, old_status, new_status
      ),
      event_payload
    );
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF TG_OP = 'INSERT' THEN
      should_queue := new_status = 'paid';
    ELSE
      should_queue := new_status = 'paid' AND old_status IS DISTINCT FROM new_status;
    END IF;

    IF should_queue THEN
      event_payload := new_row;
      PERFORM public.negis_queue_automation_event(
        target_clinic_id, 'payment.received', 'payment', target_entity_id,
        format('payment.received:%s', target_entity_id), event_payload
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_automation_lead_created ON public.leads;
CREATE TRIGGER negis_automation_lead_created
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.negis_capture_automation_event();

DROP TRIGGER IF EXISTS negis_automation_contact_created ON public.contacts;
CREATE TRIGGER negis_automation_contact_created
  AFTER INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.negis_capture_automation_event();

DROP TRIGGER IF EXISTS negis_automation_deal_stage_changed ON public.deals;
CREATE TRIGGER negis_automation_deal_stage_changed
  AFTER UPDATE OF stage, status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.negis_capture_automation_event();

DROP TRIGGER IF EXISTS negis_automation_payment_received ON public.payments;
CREATE TRIGGER negis_automation_payment_received
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.negis_capture_automation_event();

CREATE OR REPLACE FUNCTION public.negis_compare_automation_condition(
  actual_value text,
  operator_name text,
  expected_value text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  actual_number numeric;
  expected_number numeric;
BEGIN
  CASE operator_name
    WHEN 'is_empty' THEN RETURN COALESCE(actual_value, '') = '';
    WHEN 'is_not_empty' THEN RETURN COALESCE(actual_value, '') <> '';
    WHEN 'equals' THEN RETURN COALESCE(actual_value, '') = COALESCE(expected_value, '');
    WHEN 'not_equals' THEN RETURN COALESCE(actual_value, '') <> COALESCE(expected_value, '');
    WHEN 'contains' THEN
      RETURN position(lower(COALESCE(expected_value, '')) IN lower(COALESCE(actual_value, ''))) > 0;
    WHEN 'greater_than' THEN
      IF COALESCE(actual_value, '') !~ '^-?[0-9]+([.][0-9]+)?$'
        OR COALESCE(expected_value, '') !~ '^-?[0-9]+([.][0-9]+)?$' THEN
        RETURN false;
      END IF;
      actual_number := actual_value::numeric;
      expected_number := expected_value::numeric;
      RETURN actual_number > expected_number;
    WHEN 'less_than' THEN
      IF COALESCE(actual_value, '') !~ '^-?[0-9]+([.][0-9]+)?$'
        OR COALESCE(expected_value, '') !~ '^-?[0-9]+([.][0-9]+)?$' THEN
        RETURN false;
      END IF;
      actual_number := actual_value::numeric;
      expected_number := expected_value::numeric;
      RETURN actual_number < expected_number;
    ELSE
      RETURN false;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_automation_conditions_match(
  rule_conditions jsonb,
  event_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  condition_item jsonb;
  object_item record;
  condition_field text;
  condition_operator text;
  condition_value text;
  actual_value text;
BEGIN
  IF rule_conditions IS NULL OR rule_conditions = '{}'::jsonb OR rule_conditions = '[]'::jsonb THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(rule_conditions) = 'object' THEN
    FOR object_item IN SELECT key, value FROM jsonb_each(rule_conditions)
    LOOP
      actual_value := event_payload ->> object_item.key;
      IF NOT public.negis_compare_automation_condition(
        actual_value,
        'equals',
        trim(both '"' FROM object_item.value::text)
      ) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  IF jsonb_typeof(rule_conditions) <> 'array' THEN
    RETURN false;
  END IF;

  FOR condition_item IN SELECT value FROM jsonb_array_elements(rule_conditions)
  LOOP
    condition_field := COALESCE(condition_item->>'field', '');
    condition_operator := COALESCE(condition_item->>'operator', 'equals');
    condition_value := COALESCE(condition_item->>'value', '');
    actual_value := event_payload ->> condition_field;

    IF condition_field = '' OR NOT public.negis_compare_automation_condition(
      actual_value, condition_operator, condition_value
    ) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_resolve_automation_agent(
  target_clinic_id uuid,
  target_value text,
  event_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate text := NULLIF(trim(COALESCE(target_value, '')), '');
  resolved_agent_id uuid;
BEGIN
  IF candidate IS NULL OR candidate IN ('owner', 'responsible', 'assignee') THEN
    candidate := COALESCE(
      event_payload->>'owner_agent_id',
      event_payload->>'assigned_to',
      event_payload->>'owner_id'
    );
  END IF;

  IF candidate IS NULL OR candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO resolved_agent_id
  FROM public.agents
  WHERE id = candidate::uuid AND clinic_id = target_clinic_id;

  RETURN resolved_agent_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_execute_automation_actions(
  target_run_id uuid,
  target_rule_id uuid,
  target_rule_name text,
  target_clinic_id uuid,
  target_entity_type text,
  target_entity_id uuid,
  event_payload jsonb,
  rule_actions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  action_item jsonb;
  action_config jsonb;
  action_type text;
  action_index integer := 0;
  action_count integer := 0;
  target_agent_id uuid;
  target_stage text;
  notification_body text;
  recipient_row record;
  invoice_amount numeric;
  invoice_currency text;
  created_task_id uuid;
  created_invoice_id uuid;
BEGIN
  IF jsonb_typeof(rule_actions) <> 'array' OR jsonb_array_length(rule_actions) = 0 THEN
    RAISE EXCEPTION 'automation rule has no actions';
  END IF;

  FOR action_item IN SELECT value FROM jsonb_array_elements(rule_actions)
  LOOP
    action_index := action_index + 1;
    action_type := COALESCE(action_item->>'type', '');
    action_config := COALESCE(action_item->'config', '{}'::jsonb);
    target_agent_id := public.negis_resolve_automation_agent(
      target_clinic_id,
      action_config->>'target',
      event_payload
    );

    IF action_type = 'notify_user' THEN
      notification_body := COALESCE(
        NULLIF(action_config->>'message', ''),
        NULLIF(action_config->>'value', ''),
        target_rule_name
      );

      FOR recipient_row IN
        SELECT agent_id
        FROM public.negis_automation_recipients(
          target_clinic_id,
          CASE WHEN action_config->>'target' = 'managers' THEN NULL ELSE target_agent_id END
        )
      LOOP
        PERFORM public.negis_add_automation_notification(
          target_clinic_id,
          recipient_row.agent_id,
          'warning',
          target_rule_name,
          notification_body,
          format('custom:%s:%s:%s', target_run_id, action_index, recipient_row.agent_id),
          CASE WHEN target_entity_type = 'lead' THEN target_entity_id ELSE NULL END,
          CASE WHEN target_entity_type = 'task' THEN target_entity_id ELSE NULL END,
          jsonb_build_object('rule_id', target_rule_id, 'run_id', target_run_id, 'entity_type', target_entity_type, 'entity_id', target_entity_id)
        );
      END LOOP;
      action_count := action_count + 1;

    ELSIF action_type = 'assign_owner' THEN
      IF target_agent_id IS NULL THEN
        RAISE EXCEPTION 'responsible employee is not selected';
      END IF;
      IF target_entity_type = 'lead' THEN
        UPDATE public.leads SET assigned_to = target_agent_id, updated_at = now()
        WHERE id = target_entity_id AND clinic_id = target_clinic_id;
      ELSIF target_entity_type = 'contact' THEN
        UPDATE public.contacts SET owner_agent_id = target_agent_id, updated_at = now()
        WHERE id = target_entity_id AND clinic_id = target_clinic_id;
      ELSIF target_entity_type = 'deal' THEN
        UPDATE public.deals SET owner_agent_id = target_agent_id, updated_at = now()
        WHERE id = target_entity_id AND clinic_id = target_clinic_id;
      ELSE
        RAISE EXCEPTION 'assign_owner is not supported for %', target_entity_type;
      END IF;
      action_count := action_count + 1;

    ELSIF action_type = 'create_task' THEN
      IF target_agent_id IS NULL THEN
        RAISE EXCEPTION 'task assignee is not selected';
      END IF;
      INSERT INTO public.tasks (
        clinic_id, assignee_id, lead_id, title, description, status, due_at
      ) VALUES (
        target_clinic_id,
        target_agent_id,
        CASE WHEN target_entity_type = 'lead' THEN target_entity_id ELSE NULL END,
        COALESCE(NULLIF(action_config->>'title', ''), NULLIF(action_config->>'value', ''), target_rule_name),
        format('Создано автоматизацией «%s».', target_rule_name),
        'new',
        now() + interval '1 day'
      ) RETURNING id INTO created_task_id;
      action_count := action_count + 1;

    ELSIF action_type = 'update_stage' THEN
      IF target_entity_type <> 'deal' THEN
        RAISE EXCEPTION 'update_stage requires a deal event';
      END IF;
      target_stage := COALESCE(NULLIF(action_config->>'value', ''), NULLIF(action_config->>'target', ''));
      IF target_stage IS NULL THEN
        RAISE EXCEPTION 'new deal stage is empty';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.deal_stages
        WHERE clinic_id = target_clinic_id
          AND code = target_stage
          AND is_active = true
      ) THEN
        RAISE EXCEPTION 'deal stage % is not available for this workspace', target_stage;
      END IF;
      UPDATE public.deals SET stage = target_stage, updated_at = now()
      WHERE id = target_entity_id AND clinic_id = target_clinic_id;
      action_count := action_count + 1;

    ELSIF action_type = 'create_invoice' THEN
      IF COALESCE(action_config->>'value', '') ~ '^[0-9]+([.][0-9]+)?$' THEN
        invoice_amount := (action_config->>'value')::numeric;
      ELSIF COALESCE(event_payload->>'amount', '') ~ '^[0-9]+([.][0-9]+)?$' THEN
        invoice_amount := (event_payload->>'amount')::numeric;
      ELSE
        invoice_amount := 0;
      END IF;

      SELECT CASE WHEN country = 'KG' THEN 'KGS' ELSE 'KZT' END
      INTO invoice_currency
      FROM public.clinics WHERE id = target_clinic_id;

      INSERT INTO public.invoices (
        clinic_id, contact_id, company_id, deal_id, number, status,
        currency, subtotal, total, due_date, notes
      ) VALUES (
        target_clinic_id,
        CASE WHEN COALESCE(event_payload->>'contact_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (event_payload->>'contact_id')::uuid ELSE NULL END,
        CASE WHEN COALESCE(event_payload->>'company_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (event_payload->>'company_id')::uuid ELSE NULL END,
        CASE WHEN target_entity_type = 'deal' THEN target_entity_id ELSE NULL END,
        format('AUTO-%s-%s-%s', to_char(now(), 'YYYYMMDDHH24MISS'), left(target_run_id::text, 8), action_index),
        'draft',
        COALESCE(invoice_currency, 'KZT'),
        invoice_amount,
        invoice_amount,
        current_date + 3,
        format('Создано автоматизацией «%s».', target_rule_name)
      ) RETURNING id INTO created_invoice_id;
      action_count := action_count + 1;

    ELSE
      RAISE EXCEPTION 'unsupported automation action: %', action_type;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'actions_executed', action_count,
    'task_id', created_task_id,
    'invoice_id', created_invoice_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_scan_automation_events()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_tasks integer := 0;
  queued_invoices integer := 0;
  queued_daily integer := 0;
  row_data record;
BEGIN
  FOR row_data IN
    SELECT t.* FROM public.tasks t
    WHERE t.due_at < now() AND t.status NOT IN ('done', 'review')
  LOOP
    PERFORM public.negis_queue_automation_event(
      row_data.clinic_id,
      'task.overdue',
      'task',
      row_data.id,
      format('task.overdue:%s:%s', row_data.id, row_data.due_at),
      to_jsonb(row_data) || jsonb_build_object('owner_id', row_data.assignee_id)
    );
    queued_tasks := queued_tasks + 1;
  END LOOP;

  FOR row_data IN
    SELECT i.* FROM public.invoices i
    WHERE i.due_date < current_date
      AND i.status IN ('issued', 'partially_paid', 'overdue')
  LOOP
    UPDATE public.invoices SET status = 'overdue', updated_at = now()
    WHERE id = row_data.id AND status <> 'overdue';
    PERFORM public.negis_queue_automation_event(
      row_data.clinic_id,
      'invoice.overdue',
      'invoice',
      row_data.id,
      format('invoice.overdue:%s:%s', row_data.id, row_data.due_date),
      to_jsonb(row_data)
    );
    queued_invoices := queued_invoices + 1;
  END LOOP;

  FOR row_data IN SELECT id, country FROM public.clinics
  LOOP
    PERFORM public.negis_queue_automation_event(
      row_data.id,
      'schedule.daily',
      'workspace',
      row_data.id,
      format('schedule.daily:%s:%s', row_data.id, current_date),
      jsonb_build_object('date', current_date, 'country', row_data.country)
    );
    queued_daily := queued_daily + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'tasks', queued_tasks,
    'invoices', queued_invoices,
    'daily', queued_daily
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_process_automation_events(max_events integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_row record;
  rule_row record;
  run_id uuid;
  action_result jsonb;
  processed_events integer := 0;
  succeeded_runs integer := 0;
  failed_runs integer := 0;
BEGIN
  FOR event_row IN
    SELECT *
    FROM public.automation_events
    WHERE status IN ('pending', 'failed')
      AND available_at <= now()
      AND attempts < 3
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(max_events, 100), 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.automation_events
    SET status = 'processing', attempts = attempts + 1, error_message = NULL
    WHERE id = event_row.id;

    BEGIN
      FOR rule_row IN
        SELECT *
        FROM public.automation_rules
        WHERE clinic_id = event_row.clinic_id
          AND rule_key LIKE 'custom_%'
          AND trigger_type = event_row.event_type
          AND is_enabled = true
          AND COALESCE(execution_mode, 'automatic') = 'automatic'
        ORDER BY created_at
      LOOP
        IF public.negis_automation_conditions_match(rule_row.conditions, event_row.payload) THEN
          INSERT INTO public.automation_runs (
            clinic_id, rule_id, trigger_entity_type, trigger_entity_id,
            status, input, started_at
          ) VALUES (
            event_row.clinic_id, rule_row.id, event_row.entity_type, event_row.entity_id,
            'running', event_row.payload, now()
          ) RETURNING id INTO run_id;

          BEGIN
            action_result := public.negis_execute_automation_actions(
              run_id,
              rule_row.id,
              rule_row.name,
              event_row.clinic_id,
              event_row.entity_type,
              event_row.entity_id,
              event_row.payload,
              rule_row.actions
            );
            UPDATE public.automation_runs
            SET status = 'succeeded', result = action_result, completed_at = now()
            WHERE id = run_id;
            succeeded_runs := succeeded_runs + 1;
          EXCEPTION WHEN OTHERS THEN
            UPDATE public.automation_runs
            SET status = 'failed', error_message = SQLERRM, completed_at = now()
            WHERE id = run_id;
            failed_runs := failed_runs + 1;
          END;
        END IF;
      END LOOP;

      UPDATE public.automation_events
      SET status = 'done', processed_at = now(), error_message = NULL
      WHERE id = event_row.id;
      processed_events := processed_events + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.automation_events
      SET status = 'failed', error_message = SQLERRM,
          available_at = now() + interval '5 minutes'
      WHERE id = event_row.id;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'events', processed_events,
    'succeeded_runs', succeeded_runs,
    'failed_runs', failed_runs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_run_custom_automations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scan_result jsonb;
  process_result jsonb;
BEGIN
  scan_result := public.negis_scan_automation_events();
  process_result := public.negis_process_automation_events(100);
  RETURN jsonb_build_object('scan', scan_result, 'process', process_result, 'executed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.negis_queue_automation_event(uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negis_scan_automation_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negis_process_automation_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negis_run_custom_automations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negis_execute_automation_actions(uuid, uuid, text, uuid, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negis_resolve_automation_agent(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'negis-custom-automation-runner'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'negis-custom-automation-runner',
    '* * * * *',
    'SELECT public.negis_run_custom_automations();'
  );
END;
$$;
