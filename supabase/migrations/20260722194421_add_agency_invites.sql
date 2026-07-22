-- Länkar en agency_clients-rad till den riktiga användaren, satt när
-- klienten accepterar sin inbjudan. NULL = fortfarande manuellt/oaccepterat.
ALTER TABLE public.agency_clients
  ADD COLUMN IF NOT EXISTS client_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE public.agency_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_client_id uuid NOT NULL REFERENCES public.agency_clients(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_invites TO authenticated;
GRANT ALL ON public.agency_invites TO service_role;

ALTER TABLE public.agency_invites ENABLE ROW LEVEL SECURITY;

-- Endast byrån som skapade inbjudan kan se/hantera den. Klienten som accepterar
-- är inte agency_user_id, så accept-flödet slår upp token via service-role
-- (samma mönster som share_tokens) istället för att förlita sig på RLS här.
CREATE POLICY "agency manages own invites" ON public.agency_invites
  FOR ALL TO authenticated
  USING (auth.uid() = agency_user_id)
  WITH CHECK (auth.uid() = agency_user_id);

CREATE INDEX agency_invites_agency_user_id_idx ON public.agency_invites(agency_user_id);
