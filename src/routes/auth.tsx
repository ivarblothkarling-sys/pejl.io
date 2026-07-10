import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { getFortnoxAuthUrl } from "@/lib/api/fortnox.functions";
import logo from "@/assets/pejl-logo.png";

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
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { company_name: company || "Mitt företag" },
          },
        });
        if (error) throw error;
        toast.success("Konto skapat! Du loggas in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Något gick fel");
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
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Vänta..." : mode === "signup" ? "Skapa konto" : "Logga in"}
            </Button>
          </form>

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
