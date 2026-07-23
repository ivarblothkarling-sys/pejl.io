import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/integritetspolicy")({
  head: () => ({
    meta: [
      { title: "Integritetspolicy — Pejl AB" },
      {
        name: "description",
        content: "Pejl AB:s integritetspolicy för hantering av personuppgifter.",
      },
      { property: "og:title", content: "Integritetspolicy — Pejl AB" },
      {
        property: "og:description",
        content: "Pejl AB:s integritetspolicy för hantering av personuppgifter.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Integritetspolicy,
});

function Integritetspolicy() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link to="/" className="text-sm font-medium text-primary hover:underline">
          ← Tillbaka till startsidan
        </Link>

        <h1 className="mt-8 font-display text-3xl font-bold tracking-tight text-foreground">
          Integritetspolicy
        </h1>

        <div className="mt-10 space-y-10">
          <Section title="Personuppgiftsansvarig">
            <p className="text-muted-foreground">
              Pejl AB är personuppgiftsansvarig för de uppgifter som behandlas i tjänsten.
            </p>
          </Section>

          <Section title="Vilka uppgifter samlas in">
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>E-postadress (för inloggning och kontakt)</li>
              <li>Fortnox-transaktioner och fakturadata (för likviditetsanalys)</li>
              <li>
                Bankdata via Tink — kontosaldo och transaktionshistorik från det bankkonto du väljer
                att koppla, hämtat direkt från din bank via Tinks öppna bank-API (open banking,
                PSD2)
              </li>
            </ul>
          </Section>

          <Section title="Varför vi behandlar uppgifter">
            <p className="text-muted-foreground">
              Uppgifterna används för att leverera likviditetsprognoser, varningar och insikter om
              ditt företags kassaflöde. Bankdata från Tink används för att jämföra ditt faktiska
              banksaldo med det bokförda saldot, så att prognosen speglar verkligheten.
            </p>
          </Section>

          <Section title="Bankkoppling via Tink">
            <p className="text-muted-foreground">
              Om du väljer att koppla ditt bankkonto sker det via Tink, en licensierad
              betaltjänstleverantör som är auktoriserad att hämta kontoinformation enligt
              PSD2-regelverket. Pejl lagrar aldrig dina bankinloggningsuppgifter — inloggningen sker
              direkt hos din bank eller via Tinks säkra flöde, och Pejl tar endast emot saldo- och
              transaktionsdata. Du kan när som helst koppla bort banken under Inställningar, vilket
              tar bort åtkomsten och raderar den hämtade bankdatan.
            </p>
          </Section>

          <Section title="Lagring">
            <p className="text-muted-foreground">
              Dina uppgifter lagras på servrar inom EU via Supabase i Frankfurt och Irland. Bankdata
              som hämtas via Tink behandlas i enlighet med Tinks egen integritetspolicy under själva
              överföringen, men lagras därefter i Pejls databas på samma sätt som övriga uppgifter.
            </p>
          </Section>

          <Section title="Hur länge sparas data">
            <p className="text-muted-foreground">
              Om du raderar ditt konto tas all personlig data — inklusive transaktioner, Fortnox-
              och Tink-kopplingar, chatthistorik och delade länkar — bort omedelbart och permanent.
              Detta går att göra själv under Inställningar → Ditt konto.
            </p>
          </Section>

          <Section title="Dina rättigheter">
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>Rätt till tillgång — begär en kopia av dina uppgifter</li>
              <li>Rätt till rättelse — be oss korrigera felaktig information</li>
              <li>Rätt till radering — begär att vi tar bort dina uppgifter</li>
              <li>
                Rätt till dataportabilitet — exportera dina transaktioner som CSV under
                Inställningar → Ditt konto
              </li>
            </ul>
          </Section>

          <Section title="Kontakt">
            <p className="text-muted-foreground">Frågor om integritetspolicyn? Kontakta oss:</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li>
                Ivar Blothkarling —{" "}
                <a
                  href="mailto:Ivarblothkarling@gmail.com"
                  className="font-medium text-primary hover:underline"
                >
                  Ivarblothkarling@gmail.com
                </a>{" "}
                ·{" "}
                <a href="tel:+46703105644" className="font-medium text-primary hover:underline">
                  070-310 56 44
                </a>
              </li>
              <li>
                Lucas Tikkanen —{" "}
                <a
                  href="mailto:tikkanenco@gmail.com"
                  className="font-medium text-primary hover:underline"
                >
                  tikkanenco@gmail.com
                </a>
              </li>
            </ul>
          </Section>
        </div>

        <footer className="mt-16 border-t border-border pt-8 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Pejl AB
        </footer>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
