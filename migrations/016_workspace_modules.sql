-- ============================================================
-- Negis 016: workspace modules and transactional onboarding.
-- Existing field name clinic_id means an organisation/workspace.
-- Safe to run more than once in Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.module_catalog (
  module_key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  route text,
  permission_key text NOT NULL,
  is_core boolean NOT NULL DEFAULT false,
  is_billable boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plan_modules (
  plan_key text NOT NULL,
  module_key text NOT NULL REFERENCES public.module_catalog(module_key) ON DELETE CASCADE,
  is_included boolean NOT NULL DEFAULT false,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_key, module_key)
);

CREATE TABLE IF NOT EXISTS public.clinic_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES public.module_catalog(module_key) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'pending_payment', 'pending_setup', 'active', 'suspended', 'disabled')),
  source text NOT NULL DEFAULT 'onboarding'
    CHECK (source IN ('core', 'plan', 'onboarding', 'marketplace', 'admin', 'legacy')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, module_key)
);

CREATE INDEX IF NOT EXISTS clinic_modules_clinic_status_idx
  ON public.clinic_modules (clinic_id, status, module_key);

CREATE TABLE IF NOT EXISTS public.clinic_onboarding_state (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 1,
  selected_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.module_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES public.module_catalog(module_key) ON DELETE RESTRICT,
  previous_status text,
  next_status text NOT NULL,
  source text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS module_audit_log_clinic_created_idx
  ON public.module_audit_log (clinic_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.negis_log_workspace_module_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.source IS NOT DISTINCT FROM NEW.source
     AND OLD.expires_at IS NOT DISTINCT FROM NEW.expires_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.module_audit_log (
    clinic_id,
    module_key,
    previous_status,
    next_status,
    source,
    actor_user_id,
    metadata
  )
  VALUES (
    NEW.clinic_id,
    NEW.module_key,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
    NEW.status,
    NEW.source,
    auth.uid(),
    jsonb_build_object(
      'operation', lower(TG_OP),
      'previous_source', CASE WHEN TG_OP = 'UPDATE' THEN OLD.source ELSE NULL END,
      'expires_at', NEW.expires_at
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_log_workspace_module_change_after_write ON public.clinic_modules;
CREATE TRIGGER negis_log_workspace_module_change_after_write
  AFTER INSERT OR UPDATE OF status, source, expires_at
  ON public.clinic_modules
  FOR EACH ROW EXECUTE FUNCTION public.negis_log_workspace_module_change();

INSERT INTO public.module_catalog
  (module_key, name, description, route, permission_key, is_core, is_billable, sort_order)
VALUES
  ('dashboard', 'Главная', 'Сводка по рабочему пространству', '/dashboard', 'dashboard', true, false, 10),
  ('crm', 'CRM', 'Контакты, компании, сделки, товары, счета и оплаты', '/sales', 'crm', true, false, 20),
  ('tasks', 'Задачи', 'Задачи, сроки, чек-листы и контроль результата', '/tasks', 'tasks', true, false, 30),
  ('marketplace', 'Маркет', 'Подключение внешних сервисов и модулей Negis', '/marketplace', 'marketplace', true, false, 40),
  ('admin', 'Админ', 'Сотрудники, роли и настройки пространства', '/admin', 'admin', true, false, 50),
  ('booking', 'Запись', 'Расписание, слоты и запись клиентов', '/booking', 'booking', false, true, 60),
  ('reception', 'Ресепшн', 'Приём и отметка прихода клиентов', '/reception', 'reception', false, true, 70),
  ('chat', 'Чат', 'Рабочие чаты и системные карточки', '/chat', 'chat', false, true, 80),
  ('ads', 'Реклама', 'Рекламные кабинеты, лиды и конверсия', '/ads', 'ads', false, true, 90),
  ('reports', 'Отчёты', 'Продажи, сотрудники, источники и оплаты', '/reports', 'reports', false, true, 100),
  ('automations', 'Автоматизации', 'Правила, триггеры и действия', '/automations', 'automation', false, true, 110),
  ('documents', 'Документы', 'Документы и связанные процессы', NULL, 'documents', false, true, 120),
  ('negis_app', 'Negis App', 'Клиентское приложение Negis', NULL, 'negis_app', false, true, 130),
  ('loyalty', 'Лояльность', 'Бонусы и сценарии возврата клиентов', NULL, 'loyalty', false, true, 140),
  ('negis_chatbot', 'Negis Чатбот', 'Чатбот Negis для подключенного канала', NULL, 'negis_chatbot', false, true, 150),
  ('ai_assistant', 'AI-ассистент', 'AI-подсказки и сводки внутри CRM', NULL, 'ai_assistant', false, true, 160)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  route = EXCLUDED.route,
  permission_key = EXCLUDED.permission_key,
  is_core = EXCLUDED.is_core,
  is_billable = EXCLUDED.is_billable,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.plan_modules (plan_key, module_key, is_included)
SELECT 'basic', module_key, is_core
FROM public.module_catalog
ON CONFLICT (plan_key, module_key) DO UPDATE SET is_included = EXCLUDED.is_included;

-- Preserve current behaviour for existing workspaces.
INSERT INTO public.clinic_modules (clinic_id, module_key, status, source, activated_at)
SELECT c.id, m.module_key, 'active', 'legacy', now()
FROM public.clinics c
CROSS JOIN public.module_catalog m
WHERE m.route IS NOT NULL
ON CONFLICT (clinic_id, module_key) DO NOTHING;

INSERT INTO public.clinic_onboarding_state (clinic_id, current_step, selected_modules, completed_at)
SELECT c.id, 4,
       COALESCE((
         SELECT jsonb_agg(cm.module_key ORDER BY cm.module_key)
         FROM public.clinic_modules cm
         WHERE cm.clinic_id = c.id AND cm.status = 'active'
       ), '[]'::jsonb),
       COALESCE(c.created_at, now())
FROM public.clinics c
ON CONFLICT (clinic_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.negis_seed_workspace_modules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.clinic_modules (clinic_id, module_key, status, source, activated_at)
  SELECT NEW.id,
         module_key,
         CASE WHEN is_core THEN 'active' ELSE 'available' END,
         CASE WHEN is_core THEN 'core' ELSE 'onboarding' END,
         CASE WHEN is_core THEN now() ELSE NULL END
  FROM public.module_catalog
  ON CONFLICT (clinic_id, module_key) DO NOTHING;

  INSERT INTO public.clinic_onboarding_state (clinic_id)
  VALUES (NEW.id)
  ON CONFLICT (clinic_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_seed_workspace_modules_after_clinic_create ON public.clinics;
CREATE TRIGGER negis_seed_workspace_modules_after_clinic_create
  AFTER INSERT ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.negis_seed_workspace_modules();

CREATE OR REPLACE FUNCTION public.negis_complete_onboarding(
  target_clinic_id uuid,
  payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected jsonb := COALESCE(payload->'modules', '[]'::jsonb);
  department jsonb;
  selected_key text;
  already_completed boolean;
BEGIN
  IF NOT public.negis_is_clinic_manager(target_clinic_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT onboarding_completed
  INTO already_completed
  FROM public.clinics
  WHERE id = target_clinic_id
  FOR UPDATE;

  IF COALESCE(already_completed, false) THEN
    RAISE EXCEPTION 'onboarding already completed';
  END IF;

  IF jsonb_typeof(selected) <> 'array' THEN
    RAISE EXCEPTION 'modules must be an array';
  END IF;

  UPDATE public.clinics
  SET country = CASE WHEN payload->>'country' = 'KG' THEN 'KG' ELSE 'KZ' END,
      business_type = COALESCE(NULLIF(payload->>'business_type', ''), business_type),
      industry = COALESCE(NULLIF(payload->>'industry', ''), industry),
      onboarding_completed = true
  WHERE id = target_clinic_id;

  UPDATE public.clinic_modules cm
  SET status = CASE
        WHEN mc.is_core THEN 'active'
        WHEN selected ? cm.module_key THEN 'active'
        ELSE 'available'
      END,
      source = CASE WHEN mc.is_core THEN 'core' ELSE 'onboarding' END,
      activated_at = CASE
        WHEN mc.is_core OR selected ? cm.module_key THEN COALESCE(cm.activated_at, now())
        ELSE NULL
      END,
      updated_at = now()
  FROM public.module_catalog mc
  WHERE cm.clinic_id = target_clinic_id
    AND mc.module_key = cm.module_key;

  FOR selected_key IN SELECT jsonb_array_elements_text(selected)
  LOOP
    INSERT INTO public.clinic_modules (clinic_id, module_key, status, source, activated_at)
    SELECT target_clinic_id, mc.module_key, 'active', 'onboarding', now()
    FROM public.module_catalog mc
    WHERE mc.module_key = selected_key
    ON CONFLICT (clinic_id, module_key) DO UPDATE SET
      status = 'active', source = 'onboarding', activated_at = COALESCE(public.clinic_modules.activated_at, now()), updated_at = now();
  END LOOP;

  IF jsonb_typeof(COALESCE(payload->'departments', '[]'::jsonb)) = 'array' THEN
    FOR department IN SELECT value FROM jsonb_array_elements(COALESCE(payload->'departments', '[]'::jsonb))
    LOOP
      IF length(trim(COALESCE(department->>'name', ''))) > 0 THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.departments existing_department
          WHERE existing_department.clinic_id = target_clinic_id
            AND lower(existing_department.name) = lower(trim(department->>'name'))
        ) THEN
          INSERT INTO public.departments (clinic_id, name, color, is_active)
          VALUES (
            target_clinic_id,
            trim(department->>'name'),
            COALESCE(NULLIF(department->>'color', ''), '#4F7BFF'),
            true
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.clinic_onboarding_state
    (clinic_id, current_step, selected_modules, draft, completed_at, completed_by, updated_at)
  VALUES
    (target_clinic_id, 4, selected, payload, now(), auth.uid(), now())
  ON CONFLICT (clinic_id) DO UPDATE SET
    current_step = 4,
    selected_modules = EXCLUDED.selected_modules,
    draft = EXCLUDED.draft,
    completed_at = EXCLUDED.completed_at,
    completed_by = EXCLUDED.completed_by,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'clinic_id', target_clinic_id, 'modules', selected);
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_request_workspace_module(
  target_clinic_id uuid,
  target_module_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_status text;
BEGIN
  IF NOT public.negis_is_clinic_manager(target_clinic_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.module_catalog
    WHERE module_key = target_module_key
      AND is_active = true
      AND is_core = false
      AND is_billable = true
  ) THEN
    RAISE EXCEPTION 'module is not available for marketplace request';
  END IF;

  INSERT INTO public.clinic_modules (
    clinic_id, module_key, status, source, activated_at, updated_at
  ) VALUES (
    target_clinic_id, target_module_key, 'pending_payment', 'marketplace', NULL, now()
  )
  ON CONFLICT (clinic_id, module_key) DO UPDATE SET
    status = CASE
      WHEN public.clinic_modules.status = 'active' THEN 'active'
      ELSE 'pending_payment'
    END,
    source = CASE
      WHEN public.clinic_modules.status = 'active' THEN public.clinic_modules.source
      ELSE 'marketplace'
    END,
    updated_at = now()
  RETURNING status INTO requested_status;

  RETURN requested_status;
END;
$$;

ALTER TABLE public.module_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_onboarding_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS module_catalog_read ON public.module_catalog;
CREATE POLICY module_catalog_read ON public.module_catalog FOR SELECT TO authenticated USING (is_active);
DROP POLICY IF EXISTS plan_modules_read ON public.plan_modules;
CREATE POLICY plan_modules_read ON public.plan_modules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS clinic_modules_read ON public.clinic_modules;
CREATE POLICY clinic_modules_read ON public.clinic_modules
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));
DROP POLICY IF EXISTS clinic_modules_manage ON public.clinic_modules;

DROP POLICY IF EXISTS clinic_onboarding_state_read ON public.clinic_onboarding_state;
CREATE POLICY clinic_onboarding_state_read ON public.clinic_onboarding_state
  FOR SELECT USING (public.negis_is_clinic_member(clinic_id));
DROP POLICY IF EXISTS clinic_onboarding_state_manage ON public.clinic_onboarding_state;

DROP POLICY IF EXISTS module_audit_log_read ON public.module_audit_log;
CREATE POLICY module_audit_log_read ON public.module_audit_log
  FOR SELECT USING (public.negis_is_clinic_manager(clinic_id));

GRANT SELECT ON public.module_catalog, public.plan_modules TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.clinic_modules, public.clinic_onboarding_state FROM authenticated;
GRANT SELECT ON public.clinic_modules, public.clinic_onboarding_state TO authenticated;
GRANT SELECT ON public.module_audit_log TO authenticated;
REVOKE ALL ON FUNCTION public.negis_complete_onboarding(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.negis_request_workspace_module(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.negis_complete_onboarding(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.negis_request_workspace_module(uuid, text) TO authenticated;
