-- Notifikationscenter: in-app-notiser. Skapas dels av de befintliga
-- mejlvarningarna i emailAlert.server.ts (forecast_warning, sync_failed,
-- weekly_summary), dels reserverat för framtida bank_discrepancy/
-- payment_overdue-flöden som inte finns ännu.
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (
    type IN ('forecast_warning', 'sync_failed', 'weekly_summary', 'bank_discrepancy', 'payment_overdue')
  ),
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notifications" ON public.notifications
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX notifications_user_created_idx ON public.notifications(user_id, created_at DESC);
-- Partiellt index för den olästa badge-räkningen — bara olästa rader är dyra att räkna ofta.
CREATE INDEX notifications_user_unread_idx ON public.notifications(user_id) WHERE read_at IS NULL;
