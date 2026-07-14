-- ============================================================
-- NEGIS Migration 010 - Departments and real tasks
-- Run in Supabase Dashboard -> SQL Editor before using Tasks.
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  manager_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  color text NOT NULL DEFAULT '#4F7BFF',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS departments_clinic_name_uidx
  ON departments(clinic_id, lower(name));
CREATE INDEX IF NOT EXISTS departments_clinic_idx ON departments(clinic_id);

CREATE TABLE IF NOT EXISTS department_members (
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, agent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS department_members_primary_agent_uidx
  ON department_members(agent_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  creator_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'review', 'done', 'returned')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'important', 'urgent')),
  due_at timestamptz,
  requires_review boolean NOT NULL DEFAULT false,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  reviewed_at timestamptz,
  returned_at timestamptz,
  legacy_source text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_clinic_status_idx ON tasks(clinic_id, status, due_at);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id, status, due_at);
CREATE INDEX IF NOT EXISTS tasks_department_idx ON tasks(department_id, status);
CREATE INDEX IF NOT EXISTS tasks_lead_idx ON tasks(lead_id);

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  is_done boolean NOT NULL DEFAULT false,
  completed_by uuid REFERENCES agents(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_checklist_items_task_idx ON task_checklist_items(task_id, position);

CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS task_watchers (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, agent_id)
);

CREATE TABLE IF NOT EXISTS task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES task_comments(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES agents(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  recipient_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  type text NOT NULL DEFAULT 'task',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_notifications_recipient_idx
  ON task_notifications(recipient_agent_id, is_read, created_at DESC);

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_notifications ENABLE ROW LEVEL SECURITY;

-- The application applies role rules in its UI; these policies prevent cross-clinic access.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['departments', 'department_members', 'tasks', 'task_checklist_items', 'task_comments', 'task_watchers', 'task_events', 'task_attachments', 'task_notifications']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_clinic_access', table_name);
  END LOOP;
END $$;

CREATE POLICY departments_clinic_access ON departments FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid()));

CREATE POLICY department_members_clinic_access ON department_members FOR ALL
  USING (department_id IN (SELECT id FROM departments WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())))
  WITH CHECK (department_id IN (SELECT id FROM departments WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY tasks_clinic_access ON tasks FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid()));

CREATE POLICY task_checklist_items_clinic_access ON task_checklist_items FOR ALL
  USING (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())))
  WITH CHECK (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY task_comments_clinic_access ON task_comments FOR ALL
  USING (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())))
  WITH CHECK (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY task_watchers_clinic_access ON task_watchers FOR ALL
  USING (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())))
  WITH CHECK (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY task_events_clinic_access ON task_events FOR ALL
  USING (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())))
  WITH CHECK (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY task_attachments_clinic_access ON task_attachments FOR ALL
  USING (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())))
  WITH CHECK (task_id IN (SELECT id FROM tasks WHERE clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY task_notifications_clinic_access ON task_notifications FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM user_roles WHERE user_id = auth.uid()));

INSERT INTO storage.buckets (id, name, public)
VALUES ('task-attachments', 'task-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS task_attachments_storage_access ON storage.objects;
CREATE POLICY task_attachments_storage_access ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'task-attachments'
    AND (storage.foldername(name))[1] IN (SELECT clinic_id::text FROM user_roles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'task-attachments'
    AND (storage.foldername(name))[1] IN (SELECT clinic_id::text FROM user_roles WHERE user_id = auth.uid())
  );

-- One-time migration of the old structured task lines stored in leads.comment.
-- Unstructured comments remain ordinary client comments, as they should.
WITH legacy AS (
  SELECT
    l.id AS lead_id,
    l.clinic_id,
    l.assigned_to,
    l.updated_at,
    trim(line) AS line,
    l.id::text || ':' || md5(trim(line)) AS legacy_source,
    trim(regexp_replace(line, '^\[[^]]+\]\s*Задача:\s*([^;]+).*$' , '\1', 'i')) AS title,
    (regexp_match(line, '(?:^|;)\s*срок:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[1] AS due_date,
    lower(coalesce((regexp_match(line, '(?:^|;)\s*статус:\s*([^;]+)', 'i'))[1], 'new')) AS old_status
  FROM leads l
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(l.comment, ''), E'\n') AS line
  WHERE trim(line) ~* '^\[[^]]+\]\s*Задача:'
)
INSERT INTO tasks (clinic_id, lead_id, assignee_id, title, status, due_at, legacy_source, created_at, updated_at)
SELECT
  clinic_id,
  lead_id,
  assigned_to,
  CASE WHEN title = '' THEN 'Задача без названия' ELSE title END,
  CASE WHEN old_status = 'done' THEN 'done' ELSE 'new' END,
  CASE WHEN due_date IS NULL THEN NULL ELSE due_date::date::timestamptz END,
  legacy_source,
  coalesce(updated_at, now()),
  coalesce(updated_at, now())
FROM legacy
ON CONFLICT (legacy_source) DO NOTHING;
