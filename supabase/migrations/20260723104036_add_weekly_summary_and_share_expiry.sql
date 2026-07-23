-- Spårar senast skickade veckobrev per användare (throttling för cron-jobbet).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_weekly_summary_sent_at timestamptz;

-- Delningslänkar ska inte vara giltiga för evigt. Nya länkar får 30 dagars
-- giltighet; befintliga länkar får samma frist räknat från migrationstillfället.
ALTER TABLE public.share_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');
