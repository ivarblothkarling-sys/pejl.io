
-- Roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('agency', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Agency clients
CREATE TABLE public.agency_clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_balance NUMERIC NOT NULL DEFAULT 0,
  threshold NUMERIC NOT NULL DEFAULT 0,
  next_warning_date DATE,
  next_warning_amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'green' CHECK (status IN ('green','yellow','red')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_clients TO authenticated;
GRANT ALL ON public.agency_clients TO service_role;

ALTER TABLE public.agency_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency manages own clients" ON public.agency_clients
  FOR ALL TO authenticated
  USING (auth.uid() = agency_user_id AND public.has_role(auth.uid(), 'agency'))
  WITH CHECK (auth.uid() = agency_user_id AND public.has_role(auth.uid(), 'agency'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_agency_clients_updated ON public.agency_clients;
CREATE TRIGGER trg_agency_clients_updated BEFORE UPDATE ON public.agency_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
