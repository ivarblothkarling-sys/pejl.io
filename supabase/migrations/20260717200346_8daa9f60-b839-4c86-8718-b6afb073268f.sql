
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'
  CHECK (approval_status IN ('approved','pending_approval'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS include_pending_in_forecast boolean NOT NULL DEFAULT false;
