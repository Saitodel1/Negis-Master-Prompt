-- Fix the shared automation trigger for tables with different row shapes.

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
