import { createFileRoute, useNavigate, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { getFortnoxAuthUrl } from "@/lib/api/fortnox.functions";
import logo from "@/assets/pejl-logo.png";

const FORTNOX_REDIRECT_URI = "https://pejl.io/auth/fortnox/callback";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Logga in — Pejl" },
      { name: "description", content: "Logga in på Pejl och få koll på företagets likviditet 30 dagar framåt." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isNestedAuthRoute = pathname !== "/auth";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [fortnoxAuthUrl, setFortnoxAuthUrl] = useState<string | null>(null);
  const [fortnoxLoading, setFortnoxLoading] = useState(false);
  const fortnoxForm = fortnoxAuthUrl
    ? (() => {
        const url = new URL(fortnoxAuthUrl);
        return {
          action: `${url.origin}${url.pathname}`,
          params: Array.from(url.searchParams.entries()),
        };
      })()
    : null;

  useEffect(() => {
    if (isNestedAuthRoute) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard" });
    });
  }, [navigate, isNestedAuthRoute]);

  if (isNestedAuthRoute) return <Outlet />;

  const prepareFortnoxAuthUrl = async () => {
    if (fortnoxAuthUrl || fortnoxLoading) return;
    setFortnoxLoading(true);
    console.log("[Fortnox] Förbereder OAuth-länk (auth). redirectUri =", FORTNOX_REDIRECT_URI);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { url } = await getFortnoxAuthUrl({ data: { redirectUri: FORTNOX_REDIRECT_URI } });
      console.log("[Fortnox] OAuth-URL förberedd (auth):", url);
      setFortnoxAuthUrl(url);
    } catch (err) {
      console.error("[Fortnox] Kunde inte förbereda OAuth på auth-sidan:", err);
      toast.error(err instanceof Error ? err.message : "Kunde inte förbereda Fortnox-koppling");
    } finally {
      setFortnoxLoading(false);
    }
  };

  function translateAuthError(err: unknown, currentMode: "signin" | "signup"): string {
    const raw = err instanceof Error ? err.message : String(err ?? "");
    const msg = raw.toLowerCase();
    const code = (err as { code?: string } | null)?.code?.toLowerCase?.() ?? "";
    if (code === "weak_password" || msg.includes("weak") || msg.includes("pwned")) {
      return "Lösenordet är för svagt eller har läckt i en tidigare dataläcka. Välj ett annat lösenord med minst 8 tecken, gärna en blandning av bokstäver, siffror och tecken.";
    }
    if (msg.includes("password") && msg.includes("short")) {
      return "Lösenordet måste vara minst 8 tecken.";
    }
    if (msg.includes("already registered") || msg.includes("user already") || code === "user_already_exists") {
      return "Ett konto med den e-postadressen finns redan. Logga in istället.";
    }
    if (msg.includes("invalid login") || msg.includes("invalid credentials") || code === "invalid_credentials") {
      return "Fel e-post eller lösenord.";
    }
    if (msg.includes("email not confirmed")) {
      return "Bekräfta din e-post via länken vi skickade innan du loggar in.";
    }
    if (msg.includes("rate limit") || msg.includes("too many")) {
      return "För många försök. Vänta en liten stund och försök igen.";
    }
    if (msg.includes("invalid email") || msg.includes("email address")) {
      return "Ogiltig e-postadress.";
    }
    if (msg.includes("signups") && msg.includes("disabled")) {
      return "Registrering är tillfälligt avstängt. Försök igen om en stund.";
    }
    return currentMode === "signup"
      ? "Kunde inte skapa kontot. Kontrollera uppgifterna och försök igen."
      : "Kunde inte logga in. Kontrollera uppgifterna och försök igen.";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error("Fyll i e-postadress.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      toast.error("Lösenordet måste vara minst 8 tecken.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { company_name: company.trim() || "Mitt företag" },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Konto skapat! Kolla din e-post för att bekräfta.");
          setMode("signin");
          return;
        }
        toast.success("Konto skapat! Du loggas in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
        if (error) throw error;
      }
      navigate({ to: mode === "signup" ? "/onboarding" : "/dashboard" });
    } catch (err) {
      console.error("[Auth]", err);
      toast.error(translateAuthError(err, mode));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-background via-secondary/40 to-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={logo} alt="Pejl" width={56} height={56} className="mb-3" />
          <h1 className="text-3xl font-semibold tracking-tight">Pejl</h1>
          <p className="text-sm text-muted-foreground mt-1">Håll koll på pengarna — 30 dagar framåt.</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="company">Företagsnamn</Label>
                <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Mitt företag AB" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">E-post</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Lösenord</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={mode === "signup" ? 8 : 6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
              {mode === "signup" && (
                <p className="text-[11px] text-muted-foreground">
                  Minst 8 tecken. Undvik vanliga lösenord — vi blockerar lösenord som läckt tidigare.
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Vänta..." : mode === "signup" ? "Skapa konto" : "Logga in"}
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t border-border">
            {fortnoxForm ? (
              <form
                action={fortnoxForm.action}
                method="GET"
                target="_top"
                onSubmit={() => {
                  console.log("[Fortnox] Koppla-knapp (auth) klickad. Native form-submit till Fortnox.");
                }}
              >
                {fortnoxForm.params.map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
                <Button type="submit" variant="outline" className="w-full">
                  <Link2 className="size-4" /> Koppla Fortnox
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onMouseEnter={prepareFortnoxAuthUrl}
                onFocus={prepareFortnoxAuthUrl}
                onClick={async () => {
                  console.log("[Fortnox] Koppla-knapp (auth) klickad. redirectUri =", FORTNOX_REDIRECT_URI);
                  try {
                    const { data } = await supabase.auth.getUser();
                    if (!data.user) {
                      toast.error("Logga in först för att koppla Fortnox.");
                      return;
                    }
                    await prepareFortnoxAuthUrl();
                  } catch (err) {
                    console.error("[Fortnox] Kunde inte starta OAuth:", err);
                    toast.error(err instanceof Error ? err.message : "Kunde inte starta Fortnox-koppling");
                  }
                }}
                disabled={fortnoxLoading}
              >
                <Link2 className="size-4" /> {fortnoxLoading ? "Förbereder Fortnox…" : "Koppla Fortnox"}
              </Button>
            )}
            <p className="text-[11px] text-center text-muted-foreground mt-2">
              Kräver inloggning — logga in eller skapa konto först.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signup" ? "Har du redan konto? Logga in" : "Inget konto? Skapa ett"}
          </button>

        </div>

        <p className="text-xs text-center text-muted-foreground mt-6">
          Demo-konto seedas med exempeldata för Fortnox (mock).{" "}
          <Link to="/" className="underline">Hem</Link>
        </p>
      </div>
    </div>
  );
}
