-- Bredda notifications.type till att även tillåta 'monthly_report' (den
-- automatiska PDF-månadsrapporten, se monthlyReportDigest.server.ts).
-- Samma dynamiska constraint-namn-uppslagning som tidigare migrationer mot
-- den här tabellen.
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
  CHECK (type IN ('forecast_warning', 'sync_failed', 'weekly_summary', 'bank_discrepancy', 'payment_overdue', 'tax_reminder', 'monthly_report'));
