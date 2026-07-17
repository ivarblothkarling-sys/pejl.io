
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

DROP POLICY IF EXISTS "agency manages own clients" ON public.agency_clients;
CREATE POLICY "agency manages own clients" ON public.agency_clients
FOR ALL TO authenticated
USING ((auth.uid() = agency_user_id) AND private.has_role(auth.uid(), 'agency'::public.app_role))
WITH CHECK ((auth.uid() = agency_user_id) AND private.has_role(auth.uid(), 'agency'::public.app_role));

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
