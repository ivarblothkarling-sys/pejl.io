CREATE TABLE public.share_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.share_tokens TO authenticated;
GRANT SELECT ON public.share_tokens TO anon;
GRANT ALL ON public.share_tokens TO service_role;

ALTER TABLE public.share_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manages own tokens" ON public.share_tokens
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "anyone can read tokens by id" ON public.share_tokens
  FOR SELECT TO anon
  USING (true);

CREATE INDEX share_tokens_user_id_idx ON public.share_tokens(user_id);