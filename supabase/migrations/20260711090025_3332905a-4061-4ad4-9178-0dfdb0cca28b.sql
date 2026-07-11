DROP POLICY IF EXISTS "anyone can read tokens by id" ON public.share_tokens;
REVOKE SELECT ON public.share_tokens FROM anon;