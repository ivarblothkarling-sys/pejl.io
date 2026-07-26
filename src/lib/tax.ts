import type { Tx } from "./forecast";

export type Country = "SE" | "NO" | "GB" | "US";
export type VatPeriod = "monthly" | "quarterly" | "yearly";

export interface TaxRule {
  type: "vat" | "employer" | "f-skatt" | "income-tax" | "sales-tax";
  dueDay: number;
  /** Kalendermånader (1–12) regeln förfaller i. */
  months: number[];
  label: string;
  mockAmount: number;
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Vilka månader momsdeklarationen förfaller i, beroende på företagets
 * momsperiod (hämtas från Fortnox — se computeTaxEvents nedan). Kvartals-
 * och årsmoms modelleras som en månads eftersläpning efter periodens slut
 * (t.ex. Q1 jan–mar → förfaller i april).
 *
 * OBS — approximation: Skatteverkets faktiska förfallodagar skiljer sig i
 * verkligheten ofta åt mellan månads- (26:e) och kvartalsmoms (vanligtvis
 * 12:e, inte 26:e), och vissa månader (januari, augusti) har egna
 * undantagsdatum. Den här implementationen följer specen som gavs ordagrant
 * (26:e för samtliga momsperioder, bara frekvensen skiljer) snarare än att
 * gissa på Skatteverkets exakta undantagskalender. Verifiera mot Skatteverkets
 * aktuella datum innan detta används för faktisk betalningsplanering.
 */
const VAT_MONTHS: Record<VatPeriod, number[]> = {
  monthly: ALL_MONTHS,
  quarterly: [1, 4, 7, 10],
  yearly: [4],
};

function vatRule(vatPeriod: VatPeriod): TaxRule {
  const labelSuffix =
    vatPeriod === "monthly" ? "" : vatPeriod === "quarterly" ? " (kvartal)" : " (årsmoms)";
  return {
    type: "vat",
    dueDay: 26,
    months: VAT_MONTHS[vatPeriod],
    label: `Momsdeklaration${labelSuffix} (uppskattat)`,
    mockAmount: 18500,
  };
}

/**
 * Övriga svenska skatte-/avgiftsregler, oberoende av momsperiod. Arbetsgivar-
 * avgifter och F-skatt förfaller båda den 12:e varje månad — tidigare fanns
 * bara en kombinerad post (9 800 kr); den summan delas nu upp i två separata
 * rader (7 000 + 2 800) så det totala mockade beloppet är oförändrat, bara
 * mer transparent uppdelat.
 *
 * Inkomstdeklarationen har mockAmount 0 med avsikt — det verkliga beloppet
 * beror helt på årets resultat, vilket appen inte har underlag att uppskatta.
 * Att hitta på en siffra hade varit mer missvisande än att visa förfallo-
 * datumet utan belopp (samma princip som "hitta inte på siffror" i chatten).
 * Datumet (30 april) är en approximation — Skatteverkets faktiska deadline
 * för inkomstdeklaration ligger ofta i början av maj; specen efterfrågade
 * uttryckligen "april".
 */
const SE_FIXED_RULES: TaxRule[] = [
  {
    type: "employer",
    dueDay: 12,
    months: ALL_MONTHS,
    label: "Arbetsgivaravgifter (uppskattat)",
    mockAmount: 7000,
  },
  {
    type: "f-skatt",
    dueDay: 12,
    months: ALL_MONTHS,
    label: "F-skatt (uppskattat)",
    mockAmount: 2800,
  },
  {
    type: "income-tax",
    dueDay: 30,
    months: [4],
    label: "Inkomstdeklaration (belopp beror på årets resultat)",
    mockAmount: 0,
  },
];

/**
 * Tax and employer-fee rules per country. Sverige är fullt konfigurerat;
 * övriga länder är platshållare tills implementation finns.
 */
export function taxRulesFor(country: Country, vatPeriod: VatPeriod): TaxRule[] {
  if (country !== "SE") return [];
  return [vatRule(vatPeriod), ...SE_FIXED_RULES];
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Beräknar samtliga förfallodatum för en regel inom [from, from+days].
 * En regel kan förfalla flera gånger inom fönstret (t.ex. månadsvis moms
 * över ett >30-dagarsfönster).
 */
function occurrencesInWindow(rule: TaxRule, from: Date, days: number): Date[] {
  const windowEnd = new Date(from);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + days);

  const dates: Date[] = [];
  // Gå igenom varje månad som helt eller delvis täcks av fönstret, plus en
  // marginal på vardera sida för att fånga månadsskiften i due-day.
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
  const cursorEnd = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth() + 1, 1));

  while (cursor < cursorEnd) {
    const month = cursor.getUTCMonth() + 1;
    if (rule.months.includes(month)) {
      const candidate = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), rule.dueDay),
      );
      if (candidate >= from && candidate <= windowEnd) dates.push(candidate);
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return dates;
}

/**
 * Beräknar exakta skatteförfallodatum för det givna landet inom ett
 * `days`-dagars fönster från `fromDate`, som Tx-objekt (category: "tax").
 * Deterministiska id:n (tax-<land>-<typ>-<datum>) gör att computeForecast
 * kan slå ihop dem in i en redan tax-inkluderande transaktionslista utan att
 * räkna dem dubbelt (se dedup-logiken i forecast.ts).
 */
export function computeTaxEvents(
  country: Country = "SE",
  fromDate: Date = new Date(),
  days = 30,
  vatPeriod: VatPeriod = "monthly",
): Tx[] {
  const rules = taxRulesFor(country, vatPeriod);
  if (rules.length === 0) return [];

  const from = new Date(Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()));

  const events: Tx[] = [];
  for (const rule of rules) {
    for (const date of occurrencesInWindow(rule, from, days)) {
      const iso = toIso(date);
      events.push({
        id: `tax-${country}-${rule.type}-${iso}`,
        kind: "expense",
        amount: rule.mockAmount,
        due_date: iso,
        description: rule.label,
        paid: false,
        category: "tax",
      });
    }
  }
  return events.sort((a, b) => a.due_date.localeCompare(b.due_date));
}
