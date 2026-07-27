-- Delningslänkar kan nu vara en förenklad "investerare"-vy (saldo/runway/
-- burn rate/90-dagarsprognos/MoM, inga fakturadetaljer) istället för den
-- fullständiga dashboard-vyn.
ALTER TABLE public.share_tokens
  ADD COLUMN IF NOT EXISTS view_type text NOT NULL DEFAULT 'dashboard';

ALTER TABLE public.share_tokens
  DROP CONSTRAINT IF EXISTS share_tokens_view_type_check;

ALTER TABLE public.share_tokens
  ADD CONSTRAINT share_tokens_view_type_check CHECK (view_type IN ('dashboard', 'investor'));
