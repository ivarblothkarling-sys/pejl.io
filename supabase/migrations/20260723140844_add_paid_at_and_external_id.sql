-- Faktiskt betalningsdatum, satt av syncFortnox (FinalPayDate) och syncTink
-- (bookingDate vid transaktionsmatchning). Se src/lib/forecast.ts —
-- kund-betalningsanalysen (analyzeCustomerPaymentDelay) är redan skriven mot
-- det här fältet men har hittills aldrig sett något ifyllt.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE INDEX IF NOT EXISTS transactions_external_id_idx
  ON public.transactions (user_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- Bredda approval_status till att även tillåta 'paid' (sätts av syncTink när
-- en banktransaktion matchas mot en öppen kundfaktura). Constraintets namn
-- letas upp dynamiskt istället för att antas, eftersom det skapades utan
-- explicit namn i en tidigare migration.
DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT con.conname INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'transactions'
    AND att.attname = 'approval_status'
    AND con.contype = 'c';

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_approval_status_check
  CHECK (approval_status IN ('approved', 'pending_approval', 'paid'));
