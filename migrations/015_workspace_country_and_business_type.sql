ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'KZ',
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'private_clinic';

ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_country_check;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_country_check CHECK (country IN ('KZ', 'KG'));

CREATE INDEX IF NOT EXISTS clinics_country_idx ON public.clinics (country);
CREATE INDEX IF NOT EXISTS clinics_business_type_idx ON public.clinics (business_type);
