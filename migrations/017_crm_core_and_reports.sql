-- ============================================================
-- Negis 017: universal CRM core and reporting.
-- Safe to run more than once in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.negis_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  bin_iin text,
  phone text,
  email text,
  website text,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companies_clinic_name_idx ON public.companies (clinic_id, name);

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  legacy_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  owner_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  phone text,
  email text,
  source text,
  tags text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_clinic_created_idx ON public.contacts (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_clinic_phone_idx ON public.contacts (clinic_id, phone);
CREATE INDEX IF NOT EXISTS contacts_company_idx ON public.contacts (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_legacy_lead_unique_idx
  ON public.contacts (legacy_lead_id)
  WHERE legacy_lead_id IS NOT NULL;

-- Existing lead intake remains operational while the universal CRM core is rolled out.
-- Every legacy lead is mirrored into contacts, so the new CRM never opens as an empty shell.
INSERT INTO public.contacts (
  clinic_id,
  legacy_lead_id,
  owner_agent_id,
  first_name,
  phone,
  email,
  source,
  notes,
  created_at,
  updated_at
)
SELECT
  l.clinic_id,
  l.id,
  l.assigned_to,
  COALESCE(NULLIF(trim(l.full_name), ''), NULLIF(trim(l.phone), ''), 'Без имени'),
  NULLIF(trim(l.phone), ''),
  NULLIF(trim(l.email), ''),
  NULLIF(trim(l.source), ''),
  COALESCE(l.comment, ''),
  COALESCE(l.created_at, now()),
  COALESCE(l.updated_at, l.created_at, now())
FROM public.leads l
ON CONFLICT (legacy_lead_id) WHERE legacy_lead_id IS NOT NULL DO UPDATE SET
  clinic_id = EXCLUDED.clinic_id,
  owner_agent_id = EXCLUDED.owner_agent_id,
  first_name = EXCLUDED.first_name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  source = EXCLUDED.source,
  notes = EXCLUDED.notes,
  updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION public.negis_sync_lead_to_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.contacts (
    clinic_id,
    legacy_lead_id,
    owner_agent_id,
    first_name,
    phone,
    email,
    source,
    notes,
    created_at,
    updated_at
  )
  VALUES (
    NEW.clinic_id,
    NEW.id,
    NEW.assigned_to,
    COALESCE(NULLIF(trim(NEW.full_name), ''), NULLIF(trim(NEW.phone), ''), 'Без имени'),
    NULLIF(trim(NEW.phone), ''),
    NULLIF(trim(NEW.email), ''),
    NULLIF(trim(NEW.source), ''),
    COALESCE(NEW.comment, ''),
    COALESCE(NEW.created_at, now()),
    COALESCE(NEW.updated_at, now())
  )
  ON CONFLICT (legacy_lead_id) WHERE legacy_lead_id IS NOT NULL DO UPDATE SET
    clinic_id = EXCLUDED.clinic_id,
    owner_agent_id = EXCLUDED.owner_agent_id,
    first_name = EXCLUDED.first_name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    source = EXCLUDED.source,
    notes = EXCLUDED.notes,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_sync_lead_to_contact_after_write ON public.leads;
CREATE TRIGGER negis_sync_lead_to_contact_after_write
  AFTER INSERT OR UPDATE OF clinic_id, assigned_to, full_name, phone, email, source, comment
  ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.negis_sync_lead_to_contact();

CREATE TABLE IF NOT EXISTS public.deal_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  probability smallint NOT NULL DEFAULT 10 CHECK (probability BETWEEN 0 AND 100),
  outcome text NOT NULL DEFAULT 'open' CHECK (outcome IN ('open', 'won', 'lost')),
  sort_order integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#4F7BFF',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);

CREATE INDEX IF NOT EXISTS deal_stages_clinic_sort_idx
  ON public.deal_stages (clinic_id, is_active, sort_order);

CREATE OR REPLACE FUNCTION public.negis_seed_deal_stages(target_clinic_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.deal_stages
    (clinic_id, code, name, probability, outcome, sort_order, color)
  VALUES
    (target_clinic_id, 'new', 'Новый', 10, 'open', 10, '#DBEAFE'),
    (target_clinic_id, 'qualification', 'Квалификация', 30, 'open', 20, '#E0E7FF'),
    (target_clinic_id, 'proposal', 'КП отправлено', 60, 'open', 30, '#EDE9FE'),
    (target_clinic_id, 'negotiation', 'Согласование', 80, 'open', 40, '#FEF3C7'),
    (target_clinic_id, 'payment', 'Оплата', 95, 'open', 50, '#D1FAE5'),
    (target_clinic_id, 'success', 'Успех', 100, 'won', 60, '#BBF7D0'),
    (target_clinic_id, 'lost', 'Отказ', 0, 'lost', 70, '#FEE2E2')
  ON CONFLICT (clinic_id, code) DO NOTHING;
END;
$$;

SELECT public.negis_seed_deal_stages(c.id) FROM public.clinics c;

CREATE OR REPLACE FUNCTION public.negis_seed_deal_stages_after_workspace_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.negis_seed_deal_stages(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_seed_deal_stages_after_workspace_create ON public.clinics;
CREATE TRIGGER negis_seed_deal_stages_after_workspace_create
  AFTER INSERT ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.negis_seed_deal_stages_after_workspace_create();

CREATE TABLE IF NOT EXISTS public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  owner_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  title text NOT NULL,
  stage_id uuid REFERENCES public.deal_stages(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'new',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'cancelled')),
  amount numeric(16,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency IN ('KZT', 'KGS', 'USD')),
  probability smallint NOT NULL DEFAULT 10 CHECK (probability BETWEEN 0 AND 100),
  source text,
  expected_close_date date,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.deal_stages(id) ON DELETE SET NULL;

UPDATE public.deals d
SET stage_id = ds.id,
    probability = ds.probability
FROM public.deal_stages ds
WHERE d.stage_id IS NULL
  AND ds.clinic_id = d.clinic_id
  AND ds.code = d.stage;

CREATE OR REPLACE FUNCTION public.negis_apply_deal_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  selected_stage public.deal_stages%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_id IS NOT NULL THEN
      SELECT * INTO selected_stage
      FROM public.deal_stages
      WHERE id = NEW.stage_id AND clinic_id = NEW.clinic_id;
    ELSE
      SELECT * INTO selected_stage
      FROM public.deal_stages
      WHERE clinic_id = NEW.clinic_id AND code = NEW.stage;
    END IF;
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT * INTO selected_stage
    FROM public.deal_stages
    WHERE id = NEW.stage_id AND clinic_id = NEW.clinic_id;
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    SELECT * INTO selected_stage
    FROM public.deal_stages
    WHERE clinic_id = NEW.clinic_id AND code = NEW.stage;
  ELSIF NEW.stage_id IS NOT NULL THEN
    SELECT * INTO selected_stage
    FROM public.deal_stages
    WHERE id = NEW.stage_id AND clinic_id = NEW.clinic_id;
  ELSE
    SELECT * INTO selected_stage
    FROM public.deal_stages
    WHERE clinic_id = NEW.clinic_id AND code = NEW.stage;
  END IF;

  IF selected_stage.id IS NULL THEN
    RAISE EXCEPTION 'deal stage is not available for this workspace';
  END IF;

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
  BEFORE INSERT OR UPDATE OF stage_id, stage, status
  ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.negis_apply_deal_stage();

CREATE INDEX IF NOT EXISTS deals_clinic_stage_idx ON public.deals (clinic_id, status, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS deals_owner_idx ON public.deals (owner_agent_id, status);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  description text NOT NULL DEFAULT '',
  unit_price numeric(16,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency IN ('KZT', 'KGS', 'USD')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, sku)
);

CREATE TABLE IF NOT EXISTS public.deal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(16,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total numeric(16,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_items_deal_idx ON public.deal_items (deal_id);

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled')),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency IN ('KZT', 'KGS', 'USD')),
  subtotal numeric(16,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount numeric(16,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(16,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  due_date date,
  issued_at timestamptz,
  paid_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, number)
);

-- Older Negis databases may already contain a smaller invoices table.
-- CREATE TABLE IF NOT EXISTS does not add new columns, so upgrade it explicitly.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KZT',
  ADD COLUMN IF NOT EXISTS subtotal numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled')) NOT VALID;

CREATE INDEX IF NOT EXISTS invoices_clinic_status_idx ON public.invoices (clinic_id, status, due_date);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(16,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total numeric(16,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON public.invoice_items (invoice_id);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency IN ('KZT', 'KGS', 'USD')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  method text NOT NULL DEFAULT 'cash',
  external_reference text,
  paid_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Same compatibility upgrade for databases that already have payments.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KZT',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'refunded')) NOT VALID;

CREATE INDEX IF NOT EXISTS payments_clinic_paid_idx ON public.payments (clinic_id, status, paid_at DESC);

CREATE OR REPLACE FUNCTION public.negis_recalculate_invoice_payment_status(target_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_total numeric(16,2);
  paid_total numeric(16,2);
BEGIN
  IF target_invoice_id IS NULL THEN
    RETURN;
  END IF;

  SELECT total INTO invoice_total
  FROM public.invoices
  WHERE id = target_invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO paid_total
  FROM public.payments
  WHERE invoice_id = target_invoice_id
    AND status = 'paid';

  UPDATE public.invoices
  SET status = CASE
        WHEN paid_total >= invoice_total AND invoice_total > 0 THEN 'paid'
        WHEN paid_total > 0 THEN 'partially_paid'
        WHEN status IN ('paid', 'partially_paid') THEN 'issued'
        ELSE status
      END,
      paid_at = CASE WHEN paid_total >= invoice_total AND invoice_total > 0 THEN COALESCE(paid_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE id = target_invoice_id
    AND status <> 'cancelled';
END;
$$;

CREATE OR REPLACE FUNCTION public.negis_sync_payment_to_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
    UPDATE public.payments SET paid_at = now() WHERE id = NEW.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.negis_recalculate_invoice_payment_status(OLD.invoice_id);
    RETURN OLD;
  END IF;

  PERFORM public.negis_recalculate_invoice_payment_status(NEW.invoice_id);
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.negis_recalculate_invoice_payment_status(OLD.invoice_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negis_sync_payment_to_invoice_after_write ON public.payments;
CREATE TRIGGER negis_sync_payment_to_invoice_after_write
  AFTER INSERT OR UPDATE OF invoice_id, amount, status OR DELETE
  ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.negis_sync_payment_to_invoice();

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  name text NOT NULL,
  report_type text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_rules
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'automatic'
  CHECK (execution_mode IN ('automatic', 'manual'));

CREATE OR REPLACE FUNCTION public.negis_has_workspace_permission(
  target_clinic_id uuid,
  target_permission text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  system_role text;
  custom_permissions jsonb;
BEGIN
  SELECT role
  INTO system_role
  FROM public.user_roles
  WHERE user_id = auth.uid()
    AND clinic_id = target_clinic_id
  LIMIT 1;

  IF system_role IN ('owner', 'manager') THEN
    RETURN true;
  END IF;

  SELECT r.permissions
  INTO custom_permissions
  FROM public.agents a
  JOIN public.roles r
    ON r.id = a.role_id
   AND r.clinic_id = a.clinic_id
  WHERE a.user_id = auth.uid()
    AND a.clinic_id = target_clinic_id
  LIMIT 1;

  IF custom_permissions IS NOT NULL THEN
    RETURN COALESCE((custom_permissions->>target_permission)::boolean, false);
  END IF;

  RETURN CASE system_role
    WHEN 'agent' THEN target_permission IN ('dashboard', 'booking', 'crm', 'tasks', 'chat')
    WHEN 'booking_agent' THEN target_permission IN ('dashboard', 'booking', 'chat')
    WHEN 'receptionist' THEN target_permission IN ('reception', 'chat')
    ELSE false
  END;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['companies','contacts','deal_stages','deals','products','invoices','payments','saved_reports']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS negis_touch_%I ON public.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER negis_touch_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.negis_touch_updated_at()', table_name, table_name);
  END LOOP;
END $$;

ALTER TABLE public.deal_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_stages_read ON public.deal_stages;
CREATE POLICY deal_stages_read ON public.deal_stages
  FOR SELECT USING (public.negis_has_workspace_permission(clinic_id, 'crm'));
DROP POLICY IF EXISTS deal_stages_manage ON public.deal_stages;
CREATE POLICY deal_stages_manage ON public.deal_stages
  FOR ALL USING (public.negis_is_clinic_manager(clinic_id))
  WITH CHECK (public.negis_is_clinic_manager(clinic_id));

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['companies','contacts','deals','products','deal_items','invoices','invoice_items','payments']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (public.negis_has_workspace_permission(clinic_id, ''crm''))', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_manage ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_manage ON public.%I FOR ALL USING (public.negis_has_workspace_permission(clinic_id, ''crm'')) WITH CHECK (public.negis_has_workspace_permission(clinic_id, ''crm''))', table_name, table_name);
  END LOOP;
END $$;

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_reports_read ON public.saved_reports;
CREATE POLICY saved_reports_read ON public.saved_reports
  FOR SELECT USING (public.negis_has_workspace_permission(clinic_id, 'reports'));
DROP POLICY IF EXISTS saved_reports_manage ON public.saved_reports;
CREATE POLICY saved_reports_manage ON public.saved_reports
  FOR ALL USING (public.negis_has_workspace_permission(clinic_id, 'reports'))
  WITH CHECK (public.negis_has_workspace_permission(clinic_id, 'reports'));

CREATE OR REPLACE FUNCTION public.negis_report_summary(
  target_clinic_id uuid,
  date_from date,
  date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_at timestamptz := COALESCE(date_from, current_date - 30)::timestamptz;
  end_at timestamptz := (COALESCE(date_to, current_date) + 1)::timestamptz;
  result jsonb;
BEGIN
  IF NOT public.negis_has_workspace_permission(target_clinic_id, 'reports') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'currency', CASE WHEN c.country = 'KG' THEN 'KGS' ELSE 'KZT' END,
    'totals', jsonb_build_object(
      'sales', COALESCE((SELECT sum(d.amount) FROM public.deals d WHERE d.clinic_id = target_clinic_id AND d.status = 'won' AND d.created_at >= start_at AND d.created_at < end_at), 0),
      'payments', COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.clinic_id = target_clinic_id AND p.status = 'paid' AND COALESCE(p.paid_at, p.created_at) >= start_at AND COALESCE(p.paid_at, p.created_at) < end_at), 0),
      'debt', GREATEST(
        COALESCE((SELECT sum(i.total) FROM public.invoices i WHERE i.clinic_id = target_clinic_id AND i.status NOT IN ('cancelled', 'paid') AND i.created_at >= start_at AND i.created_at < end_at), 0)
        - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.clinic_id = target_clinic_id AND p.status = 'paid' AND p.created_at >= start_at AND p.created_at < end_at), 0),
        0
      ),
      'deals', (SELECT count(*) FROM public.deals d WHERE d.clinic_id = target_clinic_id AND d.created_at >= start_at AND d.created_at < end_at),
      'won', (SELECT count(*) FROM public.deals d WHERE d.clinic_id = target_clinic_id AND d.status = 'won' AND d.created_at >= start_at AND d.created_at < end_at),
      'won_conversion', COALESCE((
        SELECT round(100.0 * count(*) FILTER (WHERE d.status = 'won') / NULLIF(count(*), 0), 2)
        FROM public.deals d
        WHERE d.clinic_id = target_clinic_id AND d.created_at >= start_at AND d.created_at < end_at
      ), 0)
    ),
    'by_source', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', source, 'deals', count_value, 'won', won_value,
        'won_conversion', CASE WHEN count_value > 0 THEN round(100.0 * won_value / count_value, 2) ELSE 0 END,
        'sales', sales_value, 'payments', 0, 'debt', 0
      ) ORDER BY sales_value DESC)
      FROM (
        SELECT COALESCE(NULLIF(d.source, ''), 'Без источника') source,
               count(*) count_value,
               count(*) FILTER (WHERE d.status = 'won') won_value,
               COALESCE(sum(d.amount) FILTER (WHERE d.status = 'won'), 0) sales_value
        FROM public.deals d
        WHERE d.clinic_id = target_clinic_id AND d.created_at >= start_at AND d.created_at < end_at
        GROUP BY COALESCE(NULLIF(d.source, ''), 'Без источника')
      ) s
    ), '[]'::jsonb),
    'by_employee', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', employee, 'deals', count_value, 'won', won_value,
        'won_conversion', CASE WHEN count_value > 0 THEN round(100.0 * won_value / count_value, 2) ELSE 0 END,
        'sales', sales_value, 'payments', 0, 'debt', 0
      ) ORDER BY sales_value DESC)
      FROM (
        SELECT COALESCE(a.name, 'Не назначен') employee,
               count(*) count_value,
               count(*) FILTER (WHERE d.status = 'won') won_value,
               COALESCE(sum(d.amount) FILTER (WHERE d.status = 'won'), 0) sales_value
        FROM public.deals d
        LEFT JOIN public.agents a ON a.id = d.owner_agent_id
        WHERE d.clinic_id = target_clinic_id AND d.created_at >= start_at AND d.created_at < end_at
        GROUP BY COALESCE(a.name, 'Не назначен')
      ) e
    ), '[]'::jsonb),
    'by_stage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', stage, 'deals', count_value, 'won', won_value,
        'won_conversion', CASE WHEN count_value > 0 THEN round(100.0 * won_value / count_value, 2) ELSE 0 END,
        'sales', sales_value, 'payments', 0, 'debt', 0
      ) ORDER BY sales_value DESC)
      FROM (
        SELECT COALESCE(ds.name, NULLIF(d.stage, ''), 'Без этапа') stage,
               count(*) count_value,
               count(*) FILTER (WHERE d.status = 'won') won_value,
               COALESCE(sum(d.amount) FILTER (WHERE d.status = 'won'), 0) sales_value
        FROM public.deals d
        LEFT JOIN public.deal_stages ds ON ds.id = d.stage_id
        WHERE d.clinic_id = target_clinic_id AND d.created_at >= start_at AND d.created_at < end_at
        GROUP BY COALESCE(ds.name, NULLIF(d.stage, ''), 'Без этапа')
      ) st
    ), '[]'::jsonb)
  ) INTO result
  FROM public.clinics c
  WHERE c.id = target_clinic_id;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.companies, public.contacts, public.deal_stages, public.deals, public.products,
  public.deal_items, public.invoices, public.invoice_items, public.payments,
  public.saved_reports
TO authenticated;
GRANT EXECUTE ON FUNCTION public.negis_report_summary(uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.negis_has_workspace_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.negis_has_workspace_permission(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.negis_seed_deal_stages(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.negis_recalculate_invoice_payment_status(uuid) FROM PUBLIC, anon, authenticated;
