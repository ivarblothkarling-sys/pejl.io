CREATE TABLE public.tink_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  bank_balance numeric,
  bank_currency text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tink_connections TO authenticated;
GRANT ALL ON public.tink_connections TO service_role;

ALTER TABLE public.tink_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tink connection"
  ON public.tink_connections FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_tink_connections_updated_at
  BEFORE UPDATE ON public.tink_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();