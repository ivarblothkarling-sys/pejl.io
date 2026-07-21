import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, Check, ExternalLink, Link2, Sparkles, ShieldAlert, Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeOnboarding, getOnboardingStatus } from "@/lib/api/onboarding.functions";
import { getFortnoxAuthUrl, getFortnoxStatus } from "@/lib/api/fortnox.functions";
import logo from "@/assets/pejl-logo.png";

const getFortnoxRedirectUri = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/auth/fortnox/callback`
    : "https://pejl.io/auth/fortnox/callback";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Kom igång — Pejl" },
      { name: "description", content: "Fyra snabba steg för att komma igång med Pejl." },
    ],
  }),
  component: OnboardingPage,
});

type Step = 1 | 2 | 3 | 4;

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [threshold, setThreshold] = useState("5000");
  const [companyName, setCompanyName] = useState("");
  const [fortnoxConnected, setFortnoxConnected] = useState(false);
  const [fortnoxAuthUrl, setFortnoxAuthUrl] = useState<string | null>(null);
  const [checkingFortnox, setCheckingFortnox] = useState(false);
  const [saving, setSaving] = useState(false);

  const completeFn = useServerFn(completeOnboarding);

  const pollFortnox = async () => {
    setCheckingFortnox(true);
    try {
      const s = await getFortnoxStatus();
      setFortnoxConnected(s.connected);
      if (!s.connected) toast.error("Ingen Fortnox-koppling hittades än. Kör kopplingen och försök igen.");
    } catch {
      /* noop */
    } finally {
      setCheckingFortnox(false);
    }
  };

  useEffect(() => {
    getOnboardingStatus()
      .then((s) => {
        if (s.completed) {
          navigate({ to: "/dashboard" });
          return;
        }
        if (s.threshold > 0) setThreshold(String(s.threshold));
        if (s.companyName) setCompanyName(s.companyName);
      })
      .catch(() => {});
    getFortnoxStatus()
      .then((s) => setFortnoxConnected(s.connected))
      .catch(() => {});
    getFortnoxAuthUrl({ data: { redirectUri: getFortnoxRedirectUri() } })
      .then(({ url }) => setFortnoxAuthUrl(url))
      .catch(() => {});
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("fortnox") === "connected") {
        setFortnoxConnected(true);
        setStep(4);
      }
    } catch {}
  }, [navigate]);

  const fortnoxForm = useMemo(() => {
    if (!fortnoxAuthUrl) return null;
    const url = new URL(fortnoxAuthUrl);
    return {
      action: `${url.origin}${url.pathname}`,
      params: Array.from(url.searchParams.entries()),
    };
  }, [fortnoxAuthUrl]);

  const handleFinish = async () => {
    const v = Number(threshold);
    if (Number.isNaN(v) || v < 0) {
      toast.error("Ange ett giltigt belopp");
      return;
    }
    setSaving(true);
    try {
      await completeFn({ data: { threshold: v, companyName } });
      toast.success("Klart! Välkommen till Pejl.");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte spara");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-secondary/30 to-background">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-2.5">
          <img src={logo} alt="Pejl" width={32} height={32} />
          <div className="font-semibold">Pejl</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-10 pb-24">
        <ProgressIndicator step={step} />

        <div className="mt-10 rounded-2xl border border-border bg-card p-6 md:p-8 shadow-sm">
          {step === 1 && (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="size-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Steg 1 av 4</span>
              </div>
              <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
                Välkommen till Pejl
              </h1>
              <p className="text-muted-foreground">
                Pejl håller koll på ditt kassaflöde 30 dagar framåt och varnar när saldot
                riskerar att gå under gränsen. Vi går igenom fyra snabba steg — det tar under en minut.
              </p>
              <div className="space-y-2">
                <Label htmlFor="company">Företagsnamn (valfritt)</Label>
                <Input
                  id="company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="t.ex. Nordic Bygg AB"
                />
              </div>
              <div className="pt-2">
                <Button onClick={() => setStep(2)}>
                  Fortsätt <ArrowRight className="size-4" />
                </Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-primary">
                <Receipt className="size-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Steg 2 av 4</span>
              </div>
              <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
                Fortnox integrationslicens krävs
              </h1>
              <p className="text-muted-foreground">
                För att Pejl ska kunna hämta fakturor och betalningar från ditt Fortnox-konto
                behöver du en <strong>integrationslicens</strong> hos Fortnox. Den kostar{" "}
                <strong>189 kr/mån</strong> och beställs direkt från Fortnox.
              </p>
              <div className="rounded-xl border border-border bg-secondary/40 p-4 text-sm space-y-2">
                <div className="font-medium text-foreground">Så gör du:</div>
                <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                  <li>Logga in på Fortnox med ditt vanliga konto.</li>
                  <li>Aktivera integrationslicensen (189 kr/mån).</li>
                  <li>Kom tillbaka hit och koppla Pejl i nästa steg.</li>
                </ol>
              </div>
              <a
                href="https://www.fortnox.se/priser/integrationer"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                Öppna Fortnox licenssida <ExternalLink className="size-4" />
              </a>
              <div className="pt-2 flex gap-2">
                <Button variant="ghost" onClick={() => setStep(1)}>Tillbaka</Button>
                <Button onClick={() => setStep(3)}>
                  Jag har licensen — fortsätt <ArrowRight className="size-4" />
                </Button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-primary">
                <Link2 className="size-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Steg 3 av 4</span>
              </div>
              <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
                Koppla Fortnox
              </h1>
              <p className="text-muted-foreground">
                Du måste koppla Fortnox för att se din prognos. Det tar 60 sekunder.
              </p>

              {fortnoxConnected ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-sm text-success">
                  <Check className="size-4" /> Fortnox ansluten
                </div>
              ) : (
                <div className="space-y-3">
                  {fortnoxForm ? (
                    <form action={fortnoxForm.action} method="GET" target="_top">
                      {fortnoxForm.params.map(([name, value]) => (
                        <input key={name} type="hidden" name={name} value={value} />
                      ))}
                      <Button type="submit">
                        <Link2 className="size-4" /> Koppla Fortnox
                      </Button>
                    </form>
                  ) : (
                    <Button disabled><Link2 className="size-4" /> Förbereder…</Button>
                  )}
                  <button
                    type="button"
                    onClick={pollFortnox}
                    disabled={checkingFortnox}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    {checkingFortnox ? "Kollar…" : "Jag har kopplat — kolla status"}
                  </button>
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <Button variant="ghost" onClick={() => setStep(2)}>Tillbaka</Button>
                <Button onClick={() => setStep(4)} disabled={!fortnoxConnected}>
                  Fortsätt <ArrowRight className="size-4" />
                </Button>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-primary">
                <ShieldAlert className="size-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Steg 4 av 4</span>
              </div>
              <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
                Sätt din varningsgräns
              </h1>
              <p className="text-muted-foreground">
                Pejl varnar dig — både i appen och via mejl — om saldot riskerar att gå under
                den här gränsen inom 30 dagar. Ett vanligt val är 1–2 månadslöner.
              </p>
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="threshold">Varningsgräns (SEK)</Label>
                <Input
                  id="threshold"
                  type="number"
                  min={0}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
              </div>
              <div className="pt-2 flex gap-2">
                <Button variant="ghost" onClick={() => setStep(3)}>Tillbaka</Button>
                <Button onClick={handleFinish} disabled={saving}>
                  {saving ? "Sparar…" : "Klar — öppna Pejl"}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function ProgressIndicator({ step }: { step: Step }) {
  const steps: { n: Step; label: string }[] = [
    { n: 1, label: "Välkommen" },
    { n: 2, label: "Licens" },
    { n: 3, label: "Koppla Fortnox" },
    { n: 4, label: "Varningsgräns" },
  ];
  return (
    <div className="flex items-center justify-between gap-2">
      {steps.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex items-center gap-2 flex-1">
            <div
              className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold shrink-0 ${
                done
                  ? "bg-success text-success-foreground"
                  : active
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground"
              }`}
            >
              {done ? <Check className="size-4" /> : s.n}
            </div>
            <div className={`text-xs md:text-sm ${active ? "text-foreground font-medium" : "text-muted-foreground"} hidden sm:block`}>
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 ${done ? "bg-success" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
