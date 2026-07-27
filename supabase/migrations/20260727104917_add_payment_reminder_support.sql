-- Sätts av sendPaymentReminder i finance.functions.ts när en betalnings-
-- påminnelse skickas till en kund — driver den optimistiska "Påminnelse
-- skickad {datum} — inväntar svar"-noteringen i dashboarden (persisteras
-- så den överlever en omladdning, till skillnad från lokal React-state).
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Bredda notifications.type till att även tillåta 'payment_reminder_sent'
-- — skild från den redan befintliga 'payment_overdue' (som är systemets
-- egen automatiska upptäckt av en försenad faktura; den nya typen loggar
-- att ANVÄNDAREN aktivt skickat en påminnelse för en specifik faktura).
DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT con.conname INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'notifications'
    AND att.attname = 'type'
    AND con.contype = 'c';

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('forecast_warning', 'sync_failed', 'weekly_summary', 'bank_discrepancy', 'payment_overdue', 'tax_reminder', 'monthly_report', 'payment_reminder_sent'));
