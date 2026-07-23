-- Spårar utfallet av den dagliga automatiska Fortnox-synken per koppling,
-- så att vi kan varna användaren efter upprepade misslyckanden i rad.
ALTER TABLE public.fortnox_connections
  ADD COLUMN IF NOT EXISTS consecutive_sync_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text;
