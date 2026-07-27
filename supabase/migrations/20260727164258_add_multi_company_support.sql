-- Multi-company support: users can connect and manage several Fortnox companies.
-- profiles keeps only account-level fields (billing, language, onboarding, last_login_at).
-- Company-specific fields (balance/threshold/country/vat_period/target/etc.) move to user_companies.

CREATE TABLE public.user_companies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fortnox_tenant_id text,
  company_name text NOT NULL DEFAULT 'Mitt företag',
  is_active boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  current_balance numeric NOT NULL DEFAULT 0,
  threshold numeric NOT NULL DEFAULT 0,
  country text NOT NULL DEFAULT 'SE',
  currency text NOT NULL DEFAULT 'SEK',
  vat_period text NOT NULL DEFAULT 'monthly',
  monthly_revenue_target numeric,
  include_pending_in_forecast boolean NOT NULL DEFAULT false,
  last_low_balance_alert_at timestamptz,
  last_low_balance_alert_key text,
  last_weekly_summary_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_companies TO authenticated;
GRANT ALL ON public.user_companies TO service_role;

ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own companies" ON public.user_companies
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Only one primary company per user.
CREATE UNIQUE INDEX user_companies_one_primary_per_user
  ON public.user_companies (user_id) WHERE is_primary;

CREATE INDEX user_companies_user_id_idx ON public.user_companies (user_id);

-- Backfill: give every existing user a primary company seeded from their profile.
INSERT INTO public.user_companies (
  user_id, company_name, is_active, is_primary,
  current_balance, threshold, country, currency, vat_period,
  monthly_revenue_target, include_pending_in_forecast,
  last_low_balance_alert_at, last_low_balance_alert_key, last_weekly_summary_sent_at
)
SELECT
  p.id, COALESCE(p.company_name, 'Mitt företag'), true, true,
  p.current_balance, p.threshold, p.country, p.currency, p.vat_period,
  p.monthly_revenue_target, p.include_pending_in_forecast,
  p.last_low_balance_alert_at, p.last_low_balance_alert_key, p.last_weekly_summary_sent_at
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_companies uc WHERE uc.user_id = p.id
);

-- transactions: scope rows to a company.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.user_companies(id) ON DELETE CASCADE;

UPDATE public.transactions t
SET company_id = uc.id
FROM public.user_companies uc
WHERE uc.user_id = t.user_id AND uc.is_primary AND t.company_id IS NULL;

CREATE INDEX IF NOT EXISTS transactions_company_id_idx ON public.transactions (company_id);

-- fortnox_connections: one connection per company instead of one per user.
ALTER TABLE public.fortnox_connections
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.user_companies(id) ON DELETE CASCADE;

UPDATE public.fortnox_connections fc
SET company_id = uc.id
FROM public.user_companies uc
WHERE uc.user_id = fc.user_id AND uc.is_primary AND fc.company_id IS NULL;

ALTER TABLE public.fortnox_connections DROP CONSTRAINT IF EXISTS fortnox_connections_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS fortnox_connections_company_id_key
  ON public.fortnox_connections (company_id) WHERE company_id IS NOT NULL;

-- RLS on fortnox_connections is still auth.uid() = user_id (unchanged), which still
-- correctly scopes multiple rows per user since user_id remains on every row.
