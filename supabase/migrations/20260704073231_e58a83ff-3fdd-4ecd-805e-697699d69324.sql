ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accounting_provider text NOT NULL DEFAULT 'fortnox',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SEK',
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'SE',
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'sv';

CREATE TABLE IF NOT EXISTS public.provider_waitlist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_waitlist TO authenticated;
GRANT ALL ON public.provider_waitlist TO service_role;

ALTER TABLE public.provider_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own waitlist" ON public.provider_waitlist
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);