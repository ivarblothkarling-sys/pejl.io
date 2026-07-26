import { computeTaxEvents, type Country, type VatPeriod } from "./tax";

export type Tx = {
  id: string;
  kind: "income" | "expense";
  amount: number;
  due_date: string; // YYYY-MM-DD
  description: string;
  paid: boolean;
  category?: "tax" | "regular";
  approval_status?: "approved" | "pending_approval";
  /**
   * Faktiskt betalningsdatum. INTE en riktig kolumn i transactions ännu — inget
   * i appen sätter den här idag (Fortnox-synken hämtar bara obetalda fakturor,
   * och det finns ingen "markera som betald"-funktion). Fältet finns ändå på
   * typen så att analyzeCustomerPaymentDelay() nedan är skriven mot rätt
   * datamodell redan nu: den fungerar med riktig logik men ser aldrig något
   * ifyllt paid_at just nu och returnerar därför alltid null (ingen justering).
   * Den dagen betalningsdatum börjar sparas (t.ex. via en "markera betald"-
   * knapp eller bankmatchning mot Tink) aktiveras analysen automatiskt utan
   * att computeForecast behöver ändras.
   */
  paid_at?: string | null;
  /** True för transaktioner som INTE är bokförda utan uppskattade av computeForecast (återkommande-detektion). */
  predicted?: boolean;
};

export type ForecastPoint = {
  date: string;
  balance: number;
  delta: number;
  events: {
    description: string;
    amount: number;
    kind: "income" | "expense";
    predicted?: boolean;
  }[];
  /** 0–100. Hur säker beräkningen är för just den här dagen — se computeConfidence(). */
  confidence_score: number;
};

export type MonthlyRevenueProgress = {
  /** "YYYY-MM" */
  month: string;
  target: number;
  /** Summan av intäkts-transaktioner med due_date i den här månaden, till och med idag (bokförda, oavsett betalstatus). */
  bookedSoFar: number;
  /** bookedSoFar + kända (redan bokförda) intäkter senare i samma månad — INTE återkommande-predikterade, bara det som faktiskt redan är fakturerat. */
  projectedTotal: number;
  /** bookedSoFar / target * 100, en decimal. */
  percentOfTarget: number;
  onTrack: boolean;
};

export type ForecastResult = {
  points: ForecastPoint[];
  threshold: number;
  startBalance: number;
  endBalance: number;
  minBalance: number;
  minDate: string;
  breachDate: string | null;
  breachAmount: number | null;
  monthlyRevenueProgress: MonthlyRevenueProgress | null;
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/**
 * Normaliserar till UTC-midnatt för samma KALENDERDATUM som d har lokalt.
 * Krävs eftersom due_date-strängar ("YYYY-MM-DD") alltid tolkas som
 * UTC-midnatt av Date-konstruktorn — att blanda lokala metoder (setHours,
 * setDate, getDate) med UTC-rendering (toISOString) driver annars datumet
 * ett dygn i tidszoner före UTC (t.ex. Sverige, UTC+1/+2). All datumaritmetik
 * i den här filen görs därför konsekvent i UTC från och med den här punkten.
 */
function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// ---------------------------------------------------------------------------
// Punkt 1 (stub): kund-betalningsanalys
// ---------------------------------------------------------------------------

/**
 * Härleder en grov "kundnyckel" ur beskrivningstexten. Det finns ingen egen
 * kund-kolumn i transactions, så det här är en heuristik — den känner igen
 * Fortnox-mönstret "Kundfaktura #123 — Kundnamn AB" och faller annars
 * tillbaka på hela beskrivningen. Två fakturor till samma kund med olika
 * fritext kan alltså tolkas som olika "kunder" — en känd begränsning.
 */
export function extractCustomerKey(description: string): string {
  const fortnoxMatch = description.match(/Kundfaktura\s*#\S*\s*—\s*(.+)$/);
  if (fortnoxMatch) return fortnoxMatch[1].trim().toLowerCase();
  return description.trim().toLowerCase();
}

export type CustomerPaymentProfile = {
  customerKey: string;
  avgDelayDays: number;
  sampleSize: number;
};

const MIN_PAYMENT_SAMPLES = 3;

/**
 * Analyserar om en kund konsekvent betalar sent, baserat på paid_at vs.
 * due_date för tidigare fakturor. Kräver minst MIN_PAYMENT_SAMPLES betalda
 * fakturor med känt betalningsdatum för att räkna ett mönster som
 * "konsekvent" — annars null (ingen justering).
 *
 * OBS: paid_at sätts aldrig av något i appen idag (se kommentaren på Tx),
 * så den här funktionen returnerar i praktiken alltid null just nu. Det är
 * avsiktligt — se punkt 1 i uppgiften den här filen uppdaterades för.
 */
export function analyzeCustomerPaymentDelay(
  customerKey: string,
  history: Tx[],
): CustomerPaymentProfile | null {
  const samples = history.filter(
    (t) =>
      t.kind === "income" &&
      t.paid &&
      t.paid_at &&
      extractCustomerKey(t.description) === customerKey,
  );
  if (samples.length < MIN_PAYMENT_SAMPLES) return null;

  const delays = samples.map((t) => {
    const dueMs = new Date(t.due_date).getTime();
    const paidMs = new Date(t.paid_at as string).getTime();
    return (paidMs - dueMs) / DAY_MS;
  });
  const avgDelayDays = delays.reduce((s, d) => s + d, 0) / delays.length;

  // Betalar i tid eller tidigt — inget att justera för.
  if (avgDelayDays < 1) return null;

  return {
    customerKey,
    avgDelayDays: Math.round(avgDelayDays * 10) / 10,
    sampleSize: samples.length,
  };
}

/**
 * Skjuter förväntat inbetalningsdatum för obetalda kundfakturor framåt om
 * kunden historiskt betalar sent (se analyzeCustomerPaymentDelay). Justerar
 * bara en lokal kopia av due_date för prognosen — rör aldrig den bokförda
 * transaktionen. No-op idag eftersom paid_at aldrig är satt (se ovan).
 */
function applyCustomerPaymentDelays(upcoming: Tx[], history: Tx[]): Tx[] {
  const profileCache = new Map<string, CustomerPaymentProfile | null>();
  return upcoming.map((t) => {
    if (t.kind !== "income" || t.paid) return t;
    const key = extractCustomerKey(t.description);
    if (!profileCache.has(key)) {
      profileCache.set(key, analyzeCustomerPaymentDelay(key, history));
    }
    const profile = profileCache.get(key);
    if (!profile) return t;

    const adjusted = new Date(t.due_date);
    adjusted.setUTCDate(adjusted.getUTCDate() + Math.round(profile.avgDelayDays));
    return { ...t, due_date: fmtDate(adjusted) };
  });
}

// ---------------------------------------------------------------------------
// Punkt 2: återkommande transaktioner
// ---------------------------------------------------------------------------

const RECURRING_MIN_OCCURRENCES = 2;
const RECURRING_INTERVAL_MIN_DAYS = 25;
const RECURRING_INTERVAL_MAX_DAYS = 35;

function normalizeDescriptionForGrouping(description: string): string {
  return description
    .toLowerCase()
    .replace(/#\S+/g, "") // fakturanummer varierar, ignorera
    .replace(/\d+/g, "") // datum/belopp i fritext varierar
    .replace(/\s+/g, " ")
    .trim();
}

export type RecurringPattern = {
  key: string;
  kind: "income" | "expense";
  description: string;
  avgAmount: number;
  avgIntervalDays: number;
  occurrences: number;
  lastDueDate: string;
};

/**
 * Grupperar historiska transaktioner på (kind, normaliserad beskrivning) och
 * plockar ut grupper där minst RECURRING_MIN_OCCURRENCES förekomster ligger
 * ~månadsvis isär (hyra, löner, prenumerationer). Bara historik — inget som
 * redan ligger i prognosfönstret.
 */
export function detectRecurringPatterns(history: Tx[]): RecurringPattern[] {
  const groups = new Map<string, Tx[]>();
  for (const t of history) {
    if (t.predicted) continue;
    const key = `${t.kind}:${normalizeDescriptionForGrouping(t.description)}`;
    if (!key.slice(key.indexOf(":") + 1).trim()) continue; // tom beskrivning efter normalisering
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const patterns: RecurringPattern[] = [];
  for (const [key, txs] of groups) {
    if (txs.length < RECURRING_MIN_OCCURRENCES) continue;
    const sorted = [...txs].sort((a, b) => a.due_date.localeCompare(b.due_date));

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap =
        (new Date(sorted[i].due_date).getTime() - new Date(sorted[i - 1].due_date).getTime()) /
        DAY_MS;
      intervals.push(gap);
    }
    const monthlyIntervals = intervals.filter(
      (g) => g >= RECURRING_INTERVAL_MIN_DAYS && g <= RECURRING_INTERVAL_MAX_DAYS,
    );
    // Kräver att minst hälften av mellanrummen ser ut som en månadscykel.
    if (monthlyIntervals.length === 0 || monthlyIntervals.length < intervals.length / 2) continue;

    const avgAmount = sorted.reduce((s, t) => s + Number(t.amount), 0) / sorted.length;
    const avgIntervalDays = monthlyIntervals.reduce((s, g) => s + g, 0) / monthlyIntervals.length;

    patterns.push({
      key,
      kind: sorted[0].kind,
      description: sorted[sorted.length - 1].description,
      avgAmount,
      avgIntervalDays,
      occurrences: sorted.length,
      lastDueDate: sorted[sorted.length - 1].due_date,
    });
  }
  return patterns;
}

/**
 * Projicerar nästa förfallodatum för varje återkommande mönster in i
 * [fromDate, fromDate+days] och returnerar dem som predicted Tx — men bara
 * om det inte redan finns en bokförd transaktion som ser ut att täcka samma
 * tillfälle (annars skulle en redan bokförd hyresfaktura dubbelräknas).
 */
function projectRecurringTransactions(
  patterns: RecurringPattern[],
  upcomingReal: Tx[],
  fromDate: Date,
  days: number,
  seasonalIndexForMonth: (month: number) => number | null,
): Tx[] {
  const windowEnd = new Date(fromDate);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + days);

  const predicted: Tx[] = [];
  for (const pattern of patterns) {
    const cursor = toUtcMidnight(new Date(pattern.lastDueDate));
    // Hoppa framåt tills vi passerat idag, sen fortsätt in i fönstret.
    let guard = 0;
    while (cursor < fromDate && guard < 24) {
      cursor.setUTCDate(cursor.getUTCDate() + Math.round(pattern.avgIntervalDays));
      guard++;
    }
    while (cursor <= windowEnd && guard < 48) {
      const projectedDate = fmtDate(cursor);
      const normalizedKey = pattern.key.slice(pattern.key.indexOf(":") + 1);
      const alreadyBooked = upcomingReal.some(
        (t) =>
          t.kind === pattern.kind &&
          normalizeDescriptionForGrouping(t.description) === normalizedKey &&
          Math.abs((new Date(t.due_date).getTime() - cursor.getTime()) / DAY_MS) <= 5,
      );
      if (!alreadyBooked) {
        let amount = pattern.avgAmount;
        if (pattern.kind === "income") {
          const seasonalIndex = seasonalIndexForMonth(cursor.getUTCMonth() + 1);
          if (seasonalIndex !== null) amount *= seasonalIndex;
        }
        predicted.push({
          id: `predicted-${pattern.key}-${projectedDate}`,
          kind: pattern.kind,
          amount: Math.round(amount * 100) / 100,
          due_date: projectedDate,
          description: `${pattern.description} (prognos, återkommande)`,
          paid: false,
          predicted: true,
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + Math.round(pattern.avgIntervalDays));
      guard++;
    }
  }
  return predicted;
}

// ---------------------------------------------------------------------------
// Punkt 3: säsongsanpassning
// ---------------------------------------------------------------------------

const SEASONAL_MIN_MONTHS_OF_HISTORY = 60; // ~2 månader totalt underlag krävs innan vi litar på ett mönster

export type SeasonalProfile = {
  /** Månad → { index, observationer }. index 1.0 = genomsnittlig månad. */
  byMonth: Map<number, { index: number; observations: number }>;
};

/**
 * Räknar ett säsongsindex per månad (1–12) för intäkter: genomsnittlig
 * månadsintäkt för den månaden delat med genomsnittlig månadsintäkt totalt.
 * Kräver minst SEASONAL_MIN_MONTHS_OF_HISTORY dagars historik totalt innan
 * något index räknas — annars är en enskild dyr eller billig månad bara
 * brus, inte säsong.
 */
export function computeSeasonalProfile(history: Tx[], fromDate: Date): SeasonalProfile {
  const incomeTxs = history.filter((t) => t.kind === "income" && !t.predicted);
  if (incomeTxs.length === 0) return { byMonth: new Map() };

  const oldestMs = Math.min(...incomeTxs.map((t) => new Date(t.due_date).getTime()));
  const spanDays = (fromDate.getTime() - oldestMs) / DAY_MS;
  if (spanDays < SEASONAL_MIN_MONTHS_OF_HISTORY) return { byMonth: new Map() };

  const byMonthTotals = new Map<number, { sum: number; count: number }>();
  let grandSum = 0;
  let grandCount = 0;
  for (const t of incomeTxs) {
    const month = new Date(t.due_date).getUTCMonth() + 1;
    const entry = byMonthTotals.get(month) ?? { sum: 0, count: 0 };
    entry.sum += Number(t.amount);
    entry.count += 1;
    byMonthTotals.set(month, entry);
    grandSum += Number(t.amount);
    grandCount += 1;
  }
  const overallAvg = grandSum / grandCount;
  if (overallAvg === 0) return { byMonth: new Map() };

  const byMonth = new Map<number, { index: number; observations: number }>();
  for (const [month, { sum, count }] of byMonthTotals) {
    const monthAvg = sum / count;
    byMonth.set(month, { index: monthAvg / overallAvg, observations: count });
  }
  return { byMonth };
}

// ---------------------------------------------------------------------------
// Punkt 4: confidence_score
// ---------------------------------------------------------------------------

function computeConfidence(
  daysFromToday: number,
  cumulativePredictedImpact: number,
  cumulativeTotalImpact: number,
  seasonalObservations: number,
): number {
  if (daysFromToday === 0) return 100; // dagens saldo är känt, ingen prognos

  // Avtar med avstånd i tiden — nära dagar är säkrare än långt fram.
  const distanceFactor = Math.max(0, 100 - daysFromToday * 2.2);

  // Ju större andel av flödet fram till den här dagen som kommer från
  // återkommande-prediktioner (istället för bokförda transaktioner), desto
  // osäkrare är dagen.
  const predictedRatio =
    cumulativeTotalImpact > 0 ? cumulativePredictedImpact / cumulativeTotalImpact : 0;
  const predictedPenalty = predictedRatio * 35;

  // Tunt säsongsunderlag (bara 1 tidigare observation av månaden) sänker
  // säkerheten något jämfört med ett välunderbyggt index.
  const seasonalPenalty = seasonalObservations === 1 ? 8 : 0;

  const score = distanceFactor - predictedPenalty - seasonalPenalty;
  return Math.max(5, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// computeForecast
// ---------------------------------------------------------------------------

/**
 * `transactions` förväntas vara ANVÄNDARENS HELA transaktionshistorik (inte
 * bara kommande obetalda) — alla nuvarande anropare hämtar redan utan
 * datumfilter, så det kräver ingen ändring hos dem. Historiken används för
 * återkommande-detektion (punkt 2), säsongsanpassning (punkt 3) och
 * kund-betalningsanalys (punkt 1, stub — se Tx.paid_at).
 */
export function computeForecast(
  startBalance: number,
  threshold: number,
  transactions: Tx[],
  days = 30,
  fromDate: Date = new Date(),
  /** null stänger av auto-injektionen helt — används av det skriptade demo-läget i dashboard.tsx. */
  country: Country | null = "SE",
  vatPeriod: VatPeriod = "monthly",
  /** null/undefined = inget mål satt — monthlyRevenueProgress blir då null. */
  monthlyTarget: number | null = null,
): ForecastResult {
  const start = toUtcMidnight(fromDate);
  const windowEnd = new Date(start);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + days);

  // Skatteförfallodagar räknas alltid in automatiskt, oavsett om anroparen
  // redan själv concat:at computeTaxEvents (flera anropare i finance.
  // functions.ts/share.functions.ts gör det, för att kunna visa dem i UI:t
  // innan prognosen räknas) — id-baserad dedup gör detta säkert att anropa
  // dubbelt utan att räkna en skattehändelse två gånger. Anropare som INTE
  // redan kände till skatter (agency.functions.ts, fortnoxDailySync.server.ts
  // m.fl.) får dem nu gratis, vilket var hela poängen med att flytta in det
  // här istället för att kräva att varje anropare kommer ihåg det själv.
  const existingIds = new Set(transactions.map((t) => t.id));
  const taxEvents = country
    ? computeTaxEvents(country, fromDate, days, vatPeriod).filter((t) => !existingIds.has(t.id))
    : [];
  const allTransactions = taxEvents.length ? [...transactions, ...taxEvents] : transactions;

  // Kassaflödesmål: oberoende av `days`-fönstret (som kan vara kortare än
  // resten av kalendermånaden, t.ex. 7-dagars inaktivitetsvarningen) —
  // räknas alltid över HELA innevarande kalendermånad mot allTransactions.
  // "prognos" här är avsiktligt begränsat till redan bokförda (riktiga)
  // intäkter senare i månaden, inte återkommande-predikterade belopp — de är
  // en mönster-gissning och hade gjort mål-uppföljningen mer spekulativ än
  // den ser ut att vara.
  let monthlyRevenueProgress: MonthlyRevenueProgress | null = null;
  if (monthlyTarget !== null && monthlyTarget > 0) {
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const monthIncome = allTransactions.filter(
      (t) =>
        t.kind === "income" &&
        new Date(t.due_date) >= monthStart &&
        new Date(t.due_date) <= monthEnd,
    );
    const bookedSoFar = monthIncome
      .filter((t) => new Date(t.due_date) <= start)
      .reduce((s, t) => s + Number(t.amount), 0);
    const restOfMonth = monthIncome
      .filter((t) => new Date(t.due_date) > start)
      .reduce((s, t) => s + Number(t.amount), 0);
    const projectedTotal = bookedSoFar + restOfMonth;
    monthlyRevenueProgress = {
      month: fmtDate(monthStart).slice(0, 7),
      target: monthlyTarget,
      bookedSoFar: Math.round(bookedSoFar * 100) / 100,
      projectedTotal: Math.round(projectedTotal * 100) / 100,
      percentOfTarget: Math.round((bookedSoFar / monthlyTarget) * 1000) / 10,
      onTrack: projectedTotal >= monthlyTarget,
    };
  }

  const history = allTransactions.filter((t) => new Date(t.due_date) < start);
  const upcomingReal = allTransactions.filter(
    (t) => !t.paid && new Date(t.due_date) >= start && new Date(t.due_date) <= windowEnd,
  );

  const seasonalProfile = computeSeasonalProfile(history, start);
  const seasonalIndexForMonth = (month: number) =>
    seasonalProfile.byMonth.get(month)?.index ?? null;

  const recurringPatterns = detectRecurringPatterns(history);
  const predictedTxs = projectRecurringTransactions(
    recurringPatterns,
    upcomingReal,
    start,
    days,
    seasonalIndexForMonth,
  );

  const delayAdjustedReal = applyCustomerPaymentDelays(upcomingReal, history);
  const effective = [...delayAdjustedReal, ...predictedTxs];

  const points: ForecastPoint[] = [];
  let balance = Number(startBalance) || 0;
  let breachDate: string | null = null;
  let breachAmount: number | null = null;
  let minBalance = balance;
  let minDate = fmtDate(start);
  let cumulativePredictedImpact = 0;
  let cumulativeTotalImpact = 0;

  for (let i = 0; i <= days; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const key = fmtDate(day);

    const todays = effective.filter((t) => t.due_date === key);
    let delta = 0;
    const events = todays.map((t) => {
      const signed = t.kind === "income" ? Number(t.amount) : -Number(t.amount);
      delta += signed;
      cumulativeTotalImpact += Math.abs(signed);
      if (t.predicted) cumulativePredictedImpact += Math.abs(signed);
      return { description: t.description, amount: signed, kind: t.kind, predicted: t.predicted };
    });

    balance += delta;
    if (balance < minBalance) {
      minBalance = balance;
      minDate = key;
    }
    if (breachDate === null && balance < threshold) {
      breachDate = key;
      breachAmount = balance;
    }

    const monthObservations = seasonalProfile.byMonth.get(day.getUTCMonth() + 1)?.observations ?? 0;
    const confidence_score = computeConfidence(
      i,
      cumulativePredictedImpact,
      cumulativeTotalImpact,
      monthObservations,
    );

    points.push({
      date: key,
      balance: Math.round(balance * 100) / 100,
      delta,
      events,
      confidence_score,
    });
  }

  return {
    points,
    threshold,
    startBalance,
    endBalance: points[points.length - 1].balance,
    minBalance: Math.round(minBalance * 100) / 100,
    minDate,
    breachDate,
    breachAmount: breachAmount === null ? null : Math.round(breachAmount * 100) / 100,
    monthlyRevenueProgress,
  };
}

export type Suggestion = {
  kind: "remind" | "defer";
  label: string;
  detail: string;
  txId: string;
  amount: number;
  date: string;
  daysFromToday: number;
};

export function computeSuggestions(
  forecast: ForecastResult,
  transactions: Tx[],
  fromDate: Date = new Date(),
): Suggestion[] {
  if (!forecast.breachDate) return [];
  const today = new Date(fromDate);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const unpaid = transactions.filter((t) => !t.paid);
  const suggestions: Suggestion[] = [];

  const incomes = unpaid
    .filter((t) => t.kind === "income")
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  if (incomes[0]) {
    const inv = incomes[0];
    const days = Math.round((new Date(inv.due_date).getTime() - todayMs) / 86400000);
    const when =
      days < 0
        ? `${Math.abs(days)} dagar försenad`
        : days === 0
          ? "förfaller idag"
          : `förfaller om ${days} dagar`;
    suggestions.push({
      kind: "remind",
      label: "Skicka betalningspåminnelse",
      detail: `${inv.description} — ${formatSEK(Number(inv.amount))} (${when})`,
      txId: inv.id,
      amount: Number(inv.amount),
      date: inv.due_date,
      daysFromToday: days,
    });
  }

  const breachMs = new Date(forecast.breachDate).getTime();
  const expensesBefore = unpaid
    .filter((t) => t.kind === "expense" && new Date(t.due_date).getTime() <= breachMs)
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  const candidate =
    expensesBefore[0] ??
    unpaid
      .filter((t) => t.kind === "expense")
      .sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  if (candidate) {
    const days = Math.round((new Date(candidate.due_date).getTime() - todayMs) / 86400000);
    suggestions.push({
      kind: "defer",
      label: "Skjut leverantörsbetalning",
      detail: `${candidate.description} — ${formatSEK(Number(candidate.amount))} (förfaller ${candidate.due_date})`,
      txId: candidate.id,
      amount: Number(candidate.amount),
      date: candidate.due_date,
      daysFromToday: days,
    });
  }

  return suggestions;
}

export const formatSEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0,
  }).format(n);

export const formatDateSv = (iso: string) =>
  new Date(iso).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });

/** "2026-07" -> "juli 2026" */
export const formatMonthSv = (yearMonth: string) =>
  new Date(`${yearMonth}-01T00:00:00Z`).toLocaleDateString("sv-SE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
