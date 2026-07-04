import { createFileRoute, Link } from "@tanstack/react-router";
import { TrendingUp, BellRing, Sparkles, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pejl — Din AI-ekonomiassistent som ser 14 dagar framåt" },
      {
        name: "description",
        content:
          "Pejl är en AI-driven ekonomiassistent som ger dig 14 dagars likviditetsprognos, varningar och smart chatt — kopplad direkt till din bokföring.",
      },
      { property: "og:title", content: "Pejl — Din AI-ekonomiassistent" },
      {
        property: "og:description",
        content:
          "Se 14 dagar framåt i kassaflödet. Få varningar innan pengarna tar slut.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="w-full border-b border-border/60">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-primary text-primary-foreground">
              <Compass className="h-4 w-4" />
            </span>
            <span className="text-lg">Pejl</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground px-2">
              Logga in
            </Link>
            <Button asChild size="sm">
              <Link to="/dashboard">Prova demo</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-60"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, var(--color-accent) 0%, transparent 60%), radial-gradient(40% 40% at 80% 30%, var(--color-primary) 0%, transparent 70%)",
          }}
        />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 sm:pb-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI-driven likviditetsprognos
          </span>
          <h1
            className="mt-6 text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Din AI-ekonomiassistent som
            <br className="hidden sm:block" />
            <span className="text-primary"> ser 14 dagar framåt</span>
          </h1>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            Koppla din bokföring och få en tydlig prognos, tidiga varningar och en smart chatt som svarar på dina ekonomifrågor.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="text-base">
              <Link to="/dashboard">Prova demo</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base">
              <Link to="/auth">Skapa konto</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">30 dagar gratis · Ingen bindning</p>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto w-full px-4 sm:px-6 pb-20">
        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-3">
          <FeatureCard
            icon={<TrendingUp className="h-5 w-5" />}
            title="Prognos"
            body="Se ditt kassaflöde 14 dagar framåt baserat på fakturor, löner och skatter."
          />
          <FeatureCard
            icon={<BellRing className="h-5 w-5" />}
            title="Varning"
            body="Få besked innan saldot går under noll — i god tid att agera."
          />
          <FeatureCard
            icon={<Sparkles className="h-5 w-5" />}
            title="Chatt"
            body="Ställ frågor på vanlig svenska: 'Har jag råd med en anställd i mars?'"
          />
        </div>

        <div className="mt-16 rounded-2xl border border-border bg-card p-8 sm:p-10 text-center">
          <h2
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Testa Pejl på 30 sekunder
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Öppna demon med förladdad data och se hur prognosen ser ut för ett typiskt småföretag.
          </p>
          <Button asChild size="lg" className="mt-6">
            <Link to="/dashboard">Prova demo</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            <span>© {new Date().getFullYear()} Pejl AB</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="mailto:hej@pejl.se" className="hover:text-foreground">
              hej@pejl.se
            </a>
            <Link to="/integritetspolicy" className="hover:text-foreground">
              Integritetspolicy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 hover:shadow-sm transition-shadow">
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-accent/30 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
