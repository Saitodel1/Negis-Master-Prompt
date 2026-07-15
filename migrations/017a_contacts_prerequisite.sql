-- ============================================================
-- Negis 017a: contacts prerequisite for CRM core.
-- Run before 017_crm_core_and_reports.sql when contacts are absent.
-- Safe to run more than once.
-- ============================================================

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

CREATE INDEX IF NOT EXISTS companies_clinic_name_idx
  ON public.companies (clinic_id, name);

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

CREATE INDEX IF NOT EXISTS contacts_clinic_created_idx
  ON public.contacts (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_clinic_phone_idx
  ON public.contacts (clinic_id, phone);
CREATE INDEX IF NOT EXISTS contacts_company_idx
  ON public.contacts (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_legacy_lead_unique_idx
  ON public.contacts (legacy_lead_id)
  WHERE legacy_lead_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.contacts') IS NULL THEN
    RAISE EXCEPTION 'Negis migration failed to create public.contacts';
  END IF;
END;
$$;
