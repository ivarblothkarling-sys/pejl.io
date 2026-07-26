-- Momsperiod styr vilka kalendermånader momsdeklarationen förfaller i (se
-- computeTaxEvents i lib/tax.ts). Standard 'monthly' matchar appens
-- tidigare hårdkodade mock-beteende.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vat_period text NOT NULL DEFAULT 'monthly'
    CHECK (vat_period IN ('monthly', 'quarterly', 'yearly'));

-- Bredda notifications.type till att även tillåta 'tax_reminder' (skatte-
-- kalenderns 7-dagars-/2-dagars-påminnelser, se fortnoxDailySync.server.ts).
-- Constraintets namn letas upp dynamiskt istället för att antas, samma
-- mönster som i add_paid_at_and_external_id.sql.
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
  CHECK (type IN ('forecast_warning', 'sync_failed', 'weekly_summary', 'bank_discrepancy', 'payment_overdue', 'tax_reminder'));
