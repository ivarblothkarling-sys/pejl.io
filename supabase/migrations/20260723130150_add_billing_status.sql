ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'trial'
    CHECK (billing_status IN ('trial', 'active', 'cancelled')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
