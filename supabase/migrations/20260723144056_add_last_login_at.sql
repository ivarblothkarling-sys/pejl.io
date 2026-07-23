-- Spårar senaste inloggning per användare — sätts av ensureUserBootstrap()
-- (userBootstrap.server.ts) varje gång dashboarden laddas. Används av
-- fortnoxDailySync.server.ts för att bara skicka kassavarnings-mejl till
-- användare som inte varit inne i appen på minst 24 timmar.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
