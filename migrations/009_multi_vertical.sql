ALTER TABLE clinics ADD COLUMN IF NOT EXISTS industry text NOT NULL DEFAULT 'clinic';
CREATE INDEX IF NOT EXISTS clinics_industry_idx ON clinics(industry);
