-- Kopplar en notis till en specifik rad i en annan tabell (t.ex. en
-- transaktion). Används av fortnoxDailySync.server.ts för att avgöra om en
-- payment_overdue-notis redan skapats för samma faktura de senaste 3
-- dagarna, utan att behöva parsa body-texten.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS related_id uuid;

CREATE INDEX IF NOT EXISTS notifications_related_id_idx
  ON public.notifications (user_id, type, related_id)
  WHERE related_id IS NOT NULL;
