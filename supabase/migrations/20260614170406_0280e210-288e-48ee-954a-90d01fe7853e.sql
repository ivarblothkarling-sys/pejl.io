
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  threshold NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Transactions (mock or real)
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  amount NUMERIC(14,2) NOT NULL,
  due_date DATE NOT NULL,
  description TEXT NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'mock',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tx" ON public.transactions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX transactions_user_due_idx ON public.transactions(user_id, due_date);

-- Chat messages
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own chat" ON public.chat_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX chat_messages_user_created_idx ON public.chat_messages(user_id, created_at);

-- Auto-create profile + seed mock transactions on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today DATE := CURRENT_DATE;
BEGIN
  INSERT INTO public.profiles (id, company_name, current_balance, threshold)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'company_name', 'Mitt företag'), 48500, 5000);

  -- Mock transactions over next 14 days (intentionally tight to trigger a warning)
  INSERT INTO public.transactions (user_id, kind, amount, due_date, description, paid, source) VALUES
    (NEW.id, 'expense', 12500, today + 1,  'Hyra lokal', false, 'mock'),
    (NEW.id, 'expense',  8200, today + 2,  'Leverantörsfaktura - Materialhuset AB', false, 'mock'),
    (NEW.id, 'income',   6800, today + 3,  'Kundfaktura #1042 - Nordic Design AB', false, 'mock'),
    (NEW.id, 'expense',  3400, today + 4,  'Telia - Telefoni & internet', false, 'mock'),
    (NEW.id, 'expense', 18900, today + 5,  'Löner (preliminärt)', false, 'mock'),
    (NEW.id, 'income',  14200, today + 6,  'Kundfaktura #1043 - Byggteknik Stockholm', false, 'mock'),
    (NEW.id, 'expense',  2150, today + 7,  'Fortnox - prenumeration', false, 'mock'),
    (NEW.id, 'expense',  6700, today + 8,  'Leverantörsfaktura - Office Supplies', false, 'mock'),
    (NEW.id, 'income',   4500, today + 9,  'Kundfaktura #1044 - Café Solrosen', false, 'mock'),
    (NEW.id, 'expense',  9800, today + 10, 'Skatteinbetalning', false, 'mock'),
    (NEW.id, 'income',  22000, today + 11, 'Kundfaktura #1045 - Mediabolaget Norr', false, 'mock'),
    (NEW.id, 'expense',  1200, today + 12, 'Försäkring', false, 'mock'),
    (NEW.id, 'expense',  4300, today + 13, 'Bensin & resor', false, 'mock'),
    (NEW.id, 'income',   7600, today + 14, 'Kundfaktura #1046 - Hantverkarna i Söder', false, 'mock');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
