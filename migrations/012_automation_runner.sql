-- ============================================================
-- Negis: scheduled automation runner
-- Requires migrations 010 and 011, plus the pg_cron extension.
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.automation_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  recipient_agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('lead', 'task', 'report', 'warning')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_notifications_dedupe_unique UNIQUE (clinic_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS automation_notifications_recipient_idx
  ON public.automation_notifications (recipient_agent_id, is_read, created_at DESC);

ALTER TABLE public.automation_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'automation_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_notifications;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END;
$$;

DROP POLICY IF EXISTS automation_notifications_read_own ON public.automation_notifications;
CREATE POLICY automation_notifications_read_own ON public.automation_notifications
  FOR SELECT
  USING (
    recipient_agent_id IN (
      SELECT id FROM public.agents WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS automation_notifications_update_own ON public.automation_notifications;
CREATE POLICY automation_notifications_update_own ON public.automation_notifications
  FOR UPDATE
  USING (
    recipient_agent_id IN (
      SELECT id FROM public.agents WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    recipient_agent_id IN (
      SELECT id FROM public.agents WHERE user_id = auth.uid()
    )
  );

-- Returns the assigned employee and managers of the organisation.
CREATE OR REPLACE FUNCTION public.negis_automation_recipients(
  target_clinic_id uuid,
  target_agent_id uuid DEFAULT NULL
)
RETURNS TABLE (agent_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT a.id
  FROM public.agents a
  LEFT JOIN public.user_roles ur
    ON ur.user_id = a.user_id
   AND ur.clinic_id = a.clinic_id
  WHERE a.clinic_id = target_clinic_id
    AND (
      (target_agent_id IS NOT NULL AND a.id = target_agent_id)
      OR ur.role IN ('owner', 'manager')
    );
$$;

CREATE OR REPLACE FUNCTION public.negis_add_automation_notification(
  target_clinic_id uuid,
  target_recipient_agent_id uuid,
  notification_kind text,
  notification_title text,
  notification_body text,
  notification_dedupe_key text,
  target_lead_id uuid DEFAULT NULL,
  target_task_id uuid DEFAULT NULL,
  notification_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.automation_notifications (
    clinic_id,
    recipient_agent_id,
    kind,
    title,
    body,
    dedupe_key,
    lead_id,
    task_id,
    payload
  ) VALUES (
    target_clinic_id,
    target_recipient_agent_id,
    notification_kind,
    notification_title,
    notification_body,
    notification_dedupe_key,
    target_lead_id,
    target_task_id,
    notification_payload
  )
  ON CONFLICT (clinic_id, dedupe_key) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.negis_run_automations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rule_row record;
  lead_row record;
  task_row record;
  recipient_row record;
  agent_row record;
  timezone_name text;
  report_date date;
  after_minutes integer;
  overload_threshold integer;
  leads_created integer;
  bookings_created integer;
  overdue_tasks integer;
  unhandled_leads integer;
  run_id uuid;
  processed_leads integer := 0;
  processed_tasks integer := 0;
  processed_reports integer := 0;
  processed_overloads integer := 0;
BEGIN
  FOR rule_row IN
    SELECT *
    FROM public.automation_rules
    WHERE is_enabled = true
  LOOP
    IF rule_row.rule_key = 'lead_no_response_15m' THEN
      after_minutes := GREATEST(COALESCE((rule_row.conditions ->> 'after_minutes')::integer, 15), 1);

      FOR lead_row IN
        SELECT l.id, l.clinic_id, l.assigned_to, l.full_name, l.created_at
        FROM public.leads l
        WHERE l.clinic_id = rule_row.clinic_id
          AND l.created_at <= now() - make_interval(mins => after_minutes)
          AND NOT EXISTS (
            SELECT 1
            FROM public.activity_events e
            WHERE e.lead_id = l.id
              AND e.occurred_at > l.created_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.automation_runs r
            WHERE r.rule_id = rule_row.id
              AND r.trigger_entity_id = l.id
              AND r.status = 'succeeded'
          )
        ORDER BY l.created_at
        LIMIT 100
      LOOP
        INSERT INTO public.automation_runs (
          clinic_id, rule_id, trigger_entity_type, trigger_entity_id,
          status, input, result, started_at, completed_at
        ) VALUES (
          rule_row.clinic_id, rule_row.id, 'lead', lead_row.id,
          'succeeded',
          jsonb_build_object('after_minutes', after_minutes),
          jsonb_build_object('action', 'notification_created'),
          now(), now()
        ) RETURNING id INTO run_id;

        FOR recipient_row IN
          SELECT agent_id
          FROM public.negis_automation_recipients(lead_row.clinic_id, lead_row.assigned_to)
        LOOP
          PERFORM public.negis_add_automation_notification(
            lead_row.clinic_id,
            recipient_row.agent_id,
            'lead',
            'Лид без ответа',
            format('По контакту «%s» нет активности более %s минут.', COALESCE(NULLIF(lead_row.full_name, ''), 'Без имени'), after_minutes),
            format('lead-no-response:%s:%s:%s', lead_row.id, recipient_row.agent_id, rule_row.id),
            lead_row.id,
            NULL,
            jsonb_build_object('rule_id', rule_row.id, 'run_id', run_id, 'after_minutes', after_minutes)
          );
        END LOOP;

        INSERT INTO public.activity_events (clinic_id, lead_id, event_type, title, payload)
        VALUES (
          lead_row.clinic_id,
          lead_row.id,
          'automation_lead_no_response',
          'Automation: lead without response',
          jsonb_build_object('rule_id', rule_row.id, 'run_id', run_id, 'after_minutes', after_minutes)
        );
        processed_leads := processed_leads + 1;
      END LOOP;

    ELSIF rule_row.rule_key = 'task_overdue' THEN
      FOR task_row IN
        SELECT t.id, t.clinic_id, t.assignee_id, t.title, t.due_at
        FROM public.tasks t
        WHERE t.clinic_id = rule_row.clinic_id
          AND t.status <> 'done'
          AND t.due_at IS NOT NULL
          AND t.due_at < now()
          AND NOT EXISTS (
            SELECT 1
            FROM public.automation_runs r
            WHERE r.rule_id = rule_row.id
              AND r.trigger_entity_id = t.id
              AND r.status = 'succeeded'
          )
        ORDER BY t.due_at
        LIMIT 100
      LOOP
        INSERT INTO public.automation_runs (
          clinic_id, rule_id, trigger_entity_type, trigger_entity_id,
          status, result, started_at, completed_at
        ) VALUES (
          task_row.clinic_id, rule_row.id, 'task', task_row.id,
          'succeeded', jsonb_build_object('action', 'notification_created'), now(), now()
        ) RETURNING id INTO run_id;

        FOR recipient_row IN
          SELECT agent_id
          FROM public.negis_automation_recipients(task_row.clinic_id, task_row.assignee_id)
        LOOP
          PERFORM public.negis_add_automation_notification(
            task_row.clinic_id,
            recipient_row.agent_id,
            'task',
            'Просроченная задача',
            format('Задача «%s» просрочена.', task_row.title),
            format('task-overdue:%s:%s:%s', task_row.id, recipient_row.agent_id, rule_row.id),
            NULL,
            task_row.id,
            jsonb_build_object('rule_id', rule_row.id, 'run_id', run_id, 'due_at', task_row.due_at)
          );
        END LOOP;
        processed_tasks := processed_tasks + 1;
      END LOOP;

    ELSIF rule_row.rule_key = 'daily_summary' THEN
      SELECT COALESCE(
        (
          SELECT b.timezone
          FROM public.branches b
          WHERE b.clinic_id = rule_row.clinic_id
          ORDER BY b.is_main DESC, b.created_at
          LIMIT 1
        ),
        'Asia/Almaty'
      ) INTO timezone_name;

      report_date := (now() AT TIME ZONE timezone_name)::date;

      IF (now() AT TIME ZONE timezone_name)::time >= make_time(COALESCE((rule_row.conditions ->> 'hour')::integer, 20), 0, 0)
        AND NOT EXISTS (
          SELECT 1
          FROM public.automation_runs r
          WHERE r.rule_id = rule_row.id
            AND r.status = 'succeeded'
            AND (r.created_at AT TIME ZONE timezone_name)::date = report_date
        )
      THEN
        SELECT count(*) INTO leads_created
        FROM public.leads l
        WHERE l.clinic_id = rule_row.clinic_id
          AND (l.created_at AT TIME ZONE timezone_name)::date = report_date;

        SELECT count(*) INTO bookings_created
        FROM public.bookings b
        WHERE b.clinic_id = rule_row.clinic_id
          AND b.date = report_date;

        SELECT count(*) INTO overdue_tasks
        FROM public.tasks t
        WHERE t.clinic_id = rule_row.clinic_id
          AND t.status <> 'done'
          AND t.due_at IS NOT NULL
          AND t.due_at < now();

        INSERT INTO public.daily_metrics (clinic_id, metric_date, metric_key, value_numeric)
        VALUES
          (rule_row.clinic_id, report_date, 'leads_created', leads_created),
          (rule_row.clinic_id, report_date, 'bookings_created', bookings_created),
          (rule_row.clinic_id, report_date, 'overdue_tasks', overdue_tasks)
        ON CONFLICT (clinic_id, metric_date, metric_key, dimension_key, dimension_value)
        DO UPDATE SET value_numeric = EXCLUDED.value_numeric, calculated_at = now();

        INSERT INTO public.automation_runs (
          clinic_id, rule_id, trigger_entity_type, status, result, started_at, completed_at
        ) VALUES (
          rule_row.clinic_id, rule_row.id, 'daily_report', 'succeeded',
          jsonb_build_object('date', report_date, 'leads_created', leads_created, 'bookings_created', bookings_created, 'overdue_tasks', overdue_tasks),
          now(), now()
        ) RETURNING id INTO run_id;

        FOR recipient_row IN
          SELECT agent_id
          FROM public.negis_automation_recipients(rule_row.clinic_id, NULL)
        LOOP
          PERFORM public.negis_add_automation_notification(
            rule_row.clinic_id,
            recipient_row.agent_id,
            'report',
            'Ежедневный отчёт готов',
            format('Лиды: %s. Записи: %s. Просроченные задачи: %s.', leads_created, bookings_created, overdue_tasks),
            format('daily-summary:%s:%s:%s', rule_row.clinic_id, report_date, recipient_row.agent_id),
            NULL,
            NULL,
            jsonb_build_object('rule_id', rule_row.id, 'run_id', run_id, 'date', report_date, 'leads_created', leads_created, 'bookings_created', bookings_created, 'overdue_tasks', overdue_tasks)
          );
        END LOOP;
        processed_reports := processed_reports + 1;
      END IF;

    ELSIF rule_row.rule_key = 'agent_overload' THEN
      overload_threshold := GREATEST(COALESCE((rule_row.conditions ->> 'open_leads_gte')::integer, 25), 1);

      FOR agent_row IN
        SELECT l.assigned_to AS agent_id, count(*) AS lead_count
        FROM public.leads l
        WHERE l.clinic_id = rule_row.clinic_id
          AND l.assigned_to IS NOT NULL
          AND l.created_at >= now() - interval '30 days'
          AND NOT EXISTS (
            SELECT 1 FROM public.activity_events e
            WHERE e.lead_id = l.id AND e.occurred_at > l.created_at
          )
        GROUP BY l.assigned_to
        HAVING count(*) >= overload_threshold
      LOOP
        IF NOT EXISTS (
          SELECT 1
          FROM public.automation_runs r
          WHERE r.rule_id = rule_row.id
            AND r.trigger_entity_id = agent_row.agent_id
            AND r.status = 'succeeded'
            AND r.created_at >= date_trunc('day', now())
        ) THEN
          INSERT INTO public.automation_runs (
            clinic_id, rule_id, trigger_entity_type, trigger_entity_id,
            status, result, started_at, completed_at
          ) VALUES (
            rule_row.clinic_id, rule_row.id, 'agent', agent_row.agent_id,
            'succeeded', jsonb_build_object('unhandled_leads', agent_row.lead_count, 'threshold', overload_threshold), now(), now()
          ) RETURNING id INTO run_id;

          FOR recipient_row IN
            SELECT agent_id
            FROM public.negis_automation_recipients(rule_row.clinic_id, NULL)
          LOOP
            PERFORM public.negis_add_automation_notification(
              rule_row.clinic_id,
              recipient_row.agent_id,
              'warning',
              'Перегрузка сотрудника',
              format('У сотрудника %s необработанных лидов. Порог: %s.', agent_row.lead_count, overload_threshold),
              format('agent-overload:%s:%s:%s:%s', agent_row.agent_id, current_date, recipient_row.agent_id, rule_row.id),
              NULL,
              NULL,
              jsonb_build_object('rule_id', rule_row.id, 'run_id', run_id, 'agent_id', agent_row.agent_id, 'unhandled_leads', agent_row.lead_count, 'threshold', overload_threshold)
            );
          END LOOP;
          processed_overloads := processed_overloads + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'executed_at', now(),
    'lead_alerts', processed_leads,
    'task_alerts', processed_tasks,
    'daily_reports', processed_reports,
    'overload_alerts', processed_overloads
  );
END;
$$;

-- Runs every five minutes. A second execution replaces the previous schedule,
-- rather than accumulating duplicate jobs.
DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'negis-automation-runner'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'negis-automation-runner',
    '*/5 * * * *',
    'SELECT public.negis_run_automations();'
  );
END;
$$;
