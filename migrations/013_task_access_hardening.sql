-- Negis: task access hardening
-- Run after 010 and 011. Replaces the broad "every member can do everything" task policies.

CREATE OR REPLACE FUNCTION public.negis_current_agent_id(target_clinic_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.agents
  WHERE clinic_id = target_clinic_id
    AND user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.negis_can_access_task(target_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = target_task_id
      AND (
        public.negis_is_clinic_manager(t.clinic_id)
        OR t.creator_agent_id = public.negis_current_agent_id(t.clinic_id)
        OR t.assignee_id = public.negis_current_agent_id(t.clinic_id)
        OR EXISTS (
          SELECT 1 FROM public.task_watchers tw
          WHERE tw.task_id = t.id
            AND tw.agent_id = public.negis_current_agent_id(t.clinic_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.negis_can_manage_task(target_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = target_task_id
      AND (
        public.negis_is_clinic_manager(t.clinic_id)
        OR t.creator_agent_id = public.negis_current_agent_id(t.clinic_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.negis_can_work_task(target_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = target_task_id
      AND (
        public.negis_can_manage_task(t.id)
        OR t.assignee_id = public.negis_current_agent_id(t.clinic_id)
      )
  );
$$;

DROP POLICY IF EXISTS departments_clinic_access ON public.departments;
DROP POLICY IF EXISTS department_members_clinic_access ON public.department_members;
DROP POLICY IF EXISTS tasks_clinic_access ON public.tasks;
DROP POLICY IF EXISTS task_checklist_items_clinic_access ON public.task_checklist_items;
DROP POLICY IF EXISTS task_comments_clinic_access ON public.task_comments;
DROP POLICY IF EXISTS task_watchers_clinic_access ON public.task_watchers;
DROP POLICY IF EXISTS task_events_clinic_access ON public.task_events;
DROP POLICY IF EXISTS task_attachments_clinic_access ON public.task_attachments;
DROP POLICY IF EXISTS task_notifications_clinic_access ON public.task_notifications;
DROP POLICY IF EXISTS task_notifications_read_own ON public.task_notifications;
DROP POLICY IF EXISTS task_notifications_update_own ON public.task_notifications;

CREATE POLICY departments_read ON public.departments FOR SELECT
  USING (public.negis_is_clinic_member(clinic_id));
CREATE POLICY departments_manage ON public.departments FOR ALL
  USING (public.negis_is_clinic_manager(clinic_id))
  WITH CHECK (public.negis_is_clinic_manager(clinic_id));

CREATE POLICY department_members_read ON public.department_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = department_id AND public.negis_is_clinic_member(d.clinic_id)
  ));
CREATE POLICY department_members_manage ON public.department_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = department_id AND public.negis_is_clinic_manager(d.clinic_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = department_id AND public.negis_is_clinic_manager(d.clinic_id)
  ));

CREATE POLICY tasks_read_allowed ON public.tasks FOR SELECT
  USING (public.negis_can_access_task(id));
CREATE POLICY tasks_create_manager ON public.tasks FOR INSERT
  WITH CHECK (
    public.negis_is_clinic_manager(clinic_id)
    AND creator_agent_id = public.negis_current_agent_id(clinic_id)
  );
CREATE POLICY tasks_update_manager ON public.tasks FOR UPDATE
  USING (public.negis_can_manage_task(id))
  WITH CHECK (public.negis_can_manage_task(id));
CREATE POLICY tasks_update_assignee ON public.tasks FOR UPDATE
  USING (assignee_id = public.negis_current_agent_id(clinic_id))
  WITH CHECK (assignee_id = public.negis_current_agent_id(clinic_id));
CREATE POLICY tasks_delete_manager_or_creator ON public.tasks FOR DELETE
  USING (public.negis_can_manage_task(id));

CREATE POLICY task_checklist_read ON public.task_checklist_items FOR SELECT
  USING (public.negis_can_access_task(task_id));
CREATE POLICY task_checklist_write ON public.task_checklist_items FOR ALL
  USING (public.negis_can_work_task(task_id))
  WITH CHECK (public.negis_can_work_task(task_id));

CREATE POLICY task_comments_read ON public.task_comments FOR SELECT
  USING (public.negis_can_access_task(task_id));
CREATE POLICY task_comments_insert ON public.task_comments FOR INSERT
  WITH CHECK (
    public.negis_can_access_task(task_id)
    AND author_id = public.negis_current_agent_id((SELECT clinic_id FROM public.tasks WHERE id = task_id))
  );

CREATE POLICY task_watchers_read ON public.task_watchers FOR SELECT
  USING (public.negis_can_access_task(task_id));
CREATE POLICY task_watchers_manage ON public.task_watchers FOR ALL
  USING (public.negis_can_manage_task(task_id))
  WITH CHECK (public.negis_can_manage_task(task_id));

CREATE POLICY task_events_read ON public.task_events FOR SELECT
  USING (public.negis_can_access_task(task_id));
CREATE POLICY task_events_insert ON public.task_events FOR INSERT
  WITH CHECK (
    public.negis_can_work_task(task_id)
    AND actor_id = public.negis_current_agent_id((SELECT clinic_id FROM public.tasks WHERE id = task_id))
  );

CREATE POLICY task_attachments_read ON public.task_attachments FOR SELECT
  USING (public.negis_can_access_task(task_id));
CREATE POLICY task_attachments_insert ON public.task_attachments FOR INSERT
  WITH CHECK (
    public.negis_can_access_task(task_id)
    AND uploaded_by = public.negis_current_agent_id((SELECT clinic_id FROM public.tasks WHERE id = task_id))
  );
CREATE POLICY task_attachments_delete ON public.task_attachments FOR DELETE
  USING (
    public.negis_can_manage_task(task_id)
    OR uploaded_by = public.negis_current_agent_id((SELECT clinic_id FROM public.tasks WHERE id = task_id))
  );

CREATE POLICY task_notifications_read_own ON public.task_notifications FOR SELECT
  USING (recipient_agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));
CREATE POLICY task_notifications_update_own ON public.task_notifications FOR UPDATE
  USING (recipient_agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()))
  WITH CHECK (recipient_agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));
CREATE POLICY task_notifications_create_manager ON public.task_notifications FOR INSERT
  WITH CHECK (public.negis_is_clinic_manager(clinic_id));

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]
WHERE id = 'task-attachments';
