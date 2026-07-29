-- Drop the orphaned company_id column that
-- was added out-of-band to user_companies.
-- This column never existed in any migration
-- file and causes NOT NULL violations on every
-- new user signup.
ALTER TABLE public.user_companies
  DROP COLUMN IF EXISTS company_id;
