-- Valfritt kassaflödesmål per kalendermånad. NULL = inget mål satt (visas
-- inte i dashboarden). Ingen CHECK på positivt värde — 0 är ett giltigt,
-- om än ovanligt, mål.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS monthly_revenue_target numeric;
