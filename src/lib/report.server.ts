// Server-only: bygger data för och renderar den månatliga PDF-rapporten.
// pdf-lib (inte @react-pdf/renderer — verifierat i en riktig wrangler dev-
// körning mot workerd, inte bara en lokal Node-körning, att @react-pdf/
// renderer kraschar där: dess layoutmotor försöker WebAssembly.instantiate()
// vid körning, vilket Cloudflare Workers blockerar. pdf-lib är ren JS utan
// WASM/native-beroenden och verifierades fungera i samma workerd-körning).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  computeForecast,
  extractCustomerKey,
  formatMonthSv,
  formatSEK,
  type Tx,
} from "@/lib/forecast";
import { computeTaxEvents, type Country, type VatPeriod } from "@/lib/tax";

const DAY_MS = 86_400_000;

export type MonthlyReportData = {
  companyName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  startBalance: number;
  endBalance: number;
  actual: { income: number; expense: number; net: number };
  forecasted: { income: number; expense: number; net: number };
  topOverdueCustomers: {
    customerKey: string;
    totalOverdue: number;
    invoiceCount: number;
    maxDaysOverdue: number;
  }[];
  nextMonthLabel: string;
  nextMonth: {
    startBalance: number;
    endBalance: number;
    minBalance: number;
    minDate: string;
    breachDate: string | null;
    breachAmount: number | null;
  };
  upcomingTaxPayments: { description: string; due_date: string; amount: number }[];
};

function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function daysInMonthOf(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bygger data för månadsrapporten om den senast HELT avslutade kalender-
 * månaden relativt referenceDate (referenceDate 1 aug → perioden är juli;
 * referenceDate 15 juli → perioden är juni). Ren datafunktion, oberoende av
 * PDF-rendering, så både den manuella nedladdningsknappen och det
 * schemalagda utskicket den 1:a använder exakt samma beräkning.
 */
export function buildMonthlyReportData(
  profile: {
    company_name?: string | null;
    current_balance?: number | null;
    threshold?: number | null;
    country?: string | null;
    vat_period?: string | null;
  },
  rawTxs: Tx[],
  referenceDate: Date = new Date(),
): MonthlyReportData {
  const country = (profile.country ?? "SE") as Country;
  const vatPeriod = (profile.vat_period ?? "monthly") as VatPeriod;
  const currentBalance = Number(profile.current_balance) || 0;
  const threshold = Number(profile.threshold) || 0;
  const today = toUtcMidnight(referenceDate);

  const periodStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const periodDays = daysInMonthOf(periodStart.getUTCFullYear(), periodStart.getUTCMonth());
  const periodEnd = new Date(
    Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodDays),
  );
  const periodStartIso = fmtIso(periodStart);
  const periodEndIso = fmtIso(periodEnd);

  // --- Faktiskt kassaflöde: riktiga bokförda transaktioner inom perioden ---
  const periodTxs = rawTxs.filter(
    (t) => t.due_date >= periodStartIso && t.due_date <= periodEndIso,
  );
  const actualIncome = periodTxs
    .filter((t) => t.kind === "income")
    .reduce((s, t) => s + Number(t.amount), 0);
  const actualExpense = periodTxs
    .filter((t) => t.kind === "expense")
    .reduce((s, t) => s + Number(t.amount), 0);

  // Bakräknar period-start-/slutsaldo från dagens (riktiga, levande) saldo
  // och kända bokförda transaktioner däremellan — ingen historisk saldo-
  // ögonblicksbild finns sparad, men det behövs inte: dagens saldo minus
  // nettot av allt som bokförts sedan periodens slut ger periodens slutsaldo,
  // och samma sak en gång till ger periodens startsaldo.
  const txsSincePeriodEnd = rawTxs.filter(
    (t) => t.due_date > periodEndIso && t.due_date <= fmtIso(today),
  );
  const netSincePeriodEnd = txsSincePeriodEnd.reduce(
    (s, t) => s + (t.kind === "income" ? Number(t.amount) : -Number(t.amount)),
    0,
  );
  const endBalance = currentBalance - netSincePeriodEnd;
  const startBalance = endBalance - (actualIncome - actualExpense);

  // --- Prognosticerat kassaflöde: vad mönsterigenkänningen + skatte-
  // kalendern skulle ha förutspått för perioden, baserat ENDAST på data som
  // fanns innan perioden — aldrig periodens egna bokförda rader (annars
  // vore det cirkelresonemang och inte en riktig jämförelse). Återanvänder
  // computeForecast rakt av (samma mönster-/skatte-injektion som den
  // riktiga prognosen), bara ankrad på periodens start istället för idag.
  const historyBeforePeriod = rawTxs.filter((t) => t.due_date < periodStartIso);
  const retro = computeForecast(
    0,
    0,
    historyBeforePeriod,
    periodDays,
    periodStart,
    country,
    vatPeriod,
  );
  let forecastedIncome = 0;
  let forecastedExpense = 0;
  for (const p of retro.points) {
    for (const e of p.events) {
      if (e.amount > 0) forecastedIncome += e.amount;
      else forecastedExpense += Math.abs(e.amount);
    }
  }

  // --- Topp 3 försenade kunder (aktuellt läge vid rapportens skapande) ---
  const unpaidIncome = rawTxs.filter((t) => t.kind === "income" && !t.paid && t.category !== "tax");
  const overdueByCustomer = new Map<
    string,
    { totalOverdue: number; invoiceCount: number; maxDaysOverdue: number }
  >();
  for (const t of unpaidIncome) {
    const daysOverdue = Math.round((today.getTime() - new Date(t.due_date).getTime()) / DAY_MS);
    if (daysOverdue <= 0) continue;
    const key = extractCustomerKey(t.description);
    const existing = overdueByCustomer.get(key) ?? {
      totalOverdue: 0,
      invoiceCount: 0,
      maxDaysOverdue: 0,
    };
    existing.totalOverdue += Number(t.amount);
    existing.invoiceCount += 1;
    existing.maxDaysOverdue = Math.max(existing.maxDaysOverdue, daysOverdue);
    overdueByCustomer.set(key, existing);
  }
  const topOverdueCustomers = [...overdueByCustomer.entries()]
    .map(([customerKey, v]) => ({ customerKey, ...v }))
    .sort((a, b) => b.totalOverdue - a.totalOverdue)
    .slice(0, 3);

  // --- Nästa månads prognos ---
  const nextMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const nextMonthDays = daysInMonthOf(
    nextMonthStart.getUTCFullYear(),
    nextMonthStart.getUTCMonth(),
  );
  const nextMonthEnd = new Date(
    Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth(), nextMonthDays),
  );
  const nextMonthStartIso = fmtIso(nextMonthStart);
  const nextMonthEndIso = fmtIso(nextMonthEnd);
  const horizonDays = Math.max(1, Math.round((nextMonthEnd.getTime() - today.getTime()) / DAY_MS));
  const forward = computeForecast(
    currentBalance,
    threshold,
    rawTxs,
    horizonDays,
    today,
    country,
    vatPeriod,
  );
  const nextMonthStartPoint =
    forward.points.find((p) => p.date >= nextMonthStartIso) ?? forward.points[0];
  const nextMonthEndPoint = forward.points[forward.points.length - 1];
  const pointsInNextMonth = forward.points.filter(
    (p) => p.date >= nextMonthStartIso && p.date <= nextMonthEndIso,
  );
  const minInNextMonth = pointsInNextMonth.reduce(
    (min, p) => (p.balance < min.balance ? p : min),
    nextMonthStartPoint,
  );
  const breachInNextMonth =
    forward.breachDate &&
    forward.breachDate >= nextMonthStartIso &&
    forward.breachDate <= nextMonthEndIso
      ? forward.breachDate
      : null;

  // --- Skattebetalningar som väntar (resten av perioden fram till nästa månads slut) ---
  const upcomingTaxPayments = computeTaxEvents(country, referenceDate, horizonDays, vatPeriod).map(
    (t) => ({ description: t.description, due_date: t.due_date, amount: t.amount }),
  );

  return {
    companyName: profile.company_name ?? "Ditt företag",
    periodLabel: formatMonthSv(periodStartIso.slice(0, 7)),
    periodStart: periodStartIso,
    periodEnd: periodEndIso,
    startBalance: Math.round(startBalance * 100) / 100,
    endBalance: Math.round(endBalance * 100) / 100,
    actual: {
      income: Math.round(actualIncome * 100) / 100,
      expense: Math.round(actualExpense * 100) / 100,
      net: Math.round((actualIncome - actualExpense) * 100) / 100,
    },
    forecasted: {
      income: Math.round(forecastedIncome * 100) / 100,
      expense: Math.round(forecastedExpense * 100) / 100,
      net: Math.round((forecastedIncome - forecastedExpense) * 100) / 100,
    },
    topOverdueCustomers,
    nextMonthLabel: formatMonthSv(nextMonthStartIso.slice(0, 7)),
    nextMonth: {
      startBalance: nextMonthStartPoint.balance,
      endBalance: nextMonthEndPoint.balance,
      minBalance: minInNextMonth.balance,
      minDate: minInNextMonth.date,
      breachDate: breachInNextMonth,
      breachAmount: breachInNextMonth ? forward.breachAmount : null,
    },
    upcomingTaxPayments,
  };
}

// ---------------------------------------------------------------------------
// PDF-rendering
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const LINE_HEIGHT = 16;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.45, 0.48, 0.55);
const ACCENT = rgb(0.83, 0.55, 0.13); // matchar Pejls orange
const NEGATIVE = rgb(0.72, 0.19, 0.19);
const POSITIVE = rgb(0.16, 0.5, 0.35);

/**
 * pdf-lib:s standardfonter använder WinAnsiEncoding, som INTE innehåller det
 * riktiga minustecknet (U+2212) — och Intl.NumberFormat (formatSEK) använder
 * just U+2212 för negativa belopp, inte ett vanligt bindestreck. Utan den
 * här saneringen kraschar renderingen så fort ett negativt belopp (t.ex. ett
 * prognostiserat underskott — själva anledningen till att appen finns) ska
 * skrivas ut. Upptäckt genom att faktiskt köra renderMonthlyReportPdf mot
 * testdata med ett negativt saldo, inte bara mot positiva exempel.
 */
function sanitizeForPdf(text: string): string {
  return text.replace(/−/g, "-");
}

/**
 * pdf-lib radbryter INTE text automatiskt (till skillnad från @react-pdf/
 * renderer, som har ett riktigt layout-flöde) — drawText ritar en enda rad
 * som fortsätter förbi sidkanten om den är för lång. Upptäckt genom att
 * faktiskt öppna en genererad rapport-PDF: den avslutande friskrivningen
 * klipptes av mitt i en mening vid sidkanten. maxWidth mäts mot den
 * faktiska fontbredden, inte en gissad teckengräns.
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

class Cursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;

  constructor(doc: PDFDocument, page: PDFPage, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.page = page;
    this.font = font;
    this.bold = bold;
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(needed: number) {
    if (this.y - needed < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  heading(text: string) {
    this.ensureSpace(LINE_HEIGHT * 2.5);
    this.y -= 6;
    this.page.drawText(sanitizeForPdf(text), {
      x: MARGIN,
      y: this.y,
      size: 14,
      font: this.bold,
      color: ACCENT,
    });
    this.y -= LINE_HEIGHT * 1.3;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    this.ensureSpace(LINE_HEIGHT);
    this.page.drawText(sanitizeForPdf(text), {
      x: MARGIN,
      y: this.y,
      size: opts.size ?? 10,
      font: opts.bold ? this.bold : this.font,
      color: opts.color ?? INK,
    });
    this.y -= LINE_HEIGHT;
  }

  /** Som text(), men radbryter mot sidans skrivbara bredd — se wrapText. */
  paragraph(text: string, opts: { size?: number; color?: ReturnType<typeof rgb> } = {}) {
    const size = opts.size ?? 8;
    const font = this.font;
    const maxWidth = PAGE_WIDTH - MARGIN * 2;
    const lines = wrapText(sanitizeForPdf(text), font, size, maxWidth);
    for (const line of lines) {
      this.ensureSpace(size + 4);
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color: opts.color ?? MUTED });
      this.y -= size + 4;
    }
  }

  row(left: string, right: string, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    this.ensureSpace(LINE_HEIGHT);
    const font = opts.bold ? this.bold : this.font;
    const size = 10;
    const safeLeft = sanitizeForPdf(left);
    const safeRight = sanitizeForPdf(right);
    this.page.drawText(safeLeft, { x: MARGIN, y: this.y, size, font, color: opts.color ?? INK });
    const rightWidth = font.widthOfTextAtSize(safeRight, size);
    this.page.drawText(safeRight, {
      x: PAGE_WIDTH - MARGIN - rightWidth,
      y: this.y,
      size,
      font,
      color: opts.color ?? INK,
    });
    this.y -= LINE_HEIGHT;
  }

  spacer(amount = LINE_HEIGHT / 2) {
    this.y -= amount;
  }

  rule() {
    this.ensureSpace(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.87),
    });
    this.y -= 10;
  }
}

/** Renderar MonthlyReportData som en PDF (pdf-lib, se filkommentaren för varför). */
export async function renderMonthlyReportPdf(data: MonthlyReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Månadsrapport ${data.periodLabel} — ${data.companyName}`);
  doc.setProducer("Pejl");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const c = new Cursor(doc, page, font, bold);

  c.page.drawText("Pejl", { x: MARGIN, y: c.y, size: 22, font: bold, color: ACCENT });
  c.y -= 28;
  c.page.drawText(sanitizeForPdf(`Månadsrapport — ${data.periodLabel}`), {
    x: MARGIN,
    y: c.y,
    size: 16,
    font: bold,
    color: INK,
  });
  c.y -= 20;
  c.text(data.companyName, { color: MUTED });
  c.spacer(10);
  c.rule();

  // 1. Sammanfattning
  c.heading("Sammanfattning av månaden");
  c.row("Ingående saldo", formatSEK(data.startBalance));
  c.row("Utgående saldo", formatSEK(data.endBalance), { bold: true });
  c.row("Nettoförändring", formatSEK(data.endBalance - data.startBalance), {
    color: data.endBalance >= data.startBalance ? POSITIVE : NEGATIVE,
  });
  c.spacer();

  // 2. Faktiska vs prognosticerade kassaflöden
  c.heading("Faktiska vs prognosticerade kassaflöden");
  c.paragraph(
    "Prognosen är beräknad i efterhand utifrån mönster och skattedatum som var kända INNAN månaden började — inte en sparad historisk prognos.",
  );
  c.spacer(6);
  c.row("", "Faktiskt", { bold: true });
  c.row("Intäkter", formatSEK(data.actual.income));
  c.row("Utgifter", formatSEK(data.actual.expense));
  c.row("Netto", formatSEK(data.actual.net), { bold: true });
  c.spacer(4);
  c.row("", "Prognosticerat", { bold: true });
  c.row("Intäkter", formatSEK(data.forecasted.income));
  c.row("Utgifter", formatSEK(data.forecasted.expense));
  c.row("Netto", formatSEK(data.forecasted.net), { bold: true });
  c.spacer(4);
  const diff = data.actual.net - data.forecasted.net;
  c.row("Avvikelse (faktiskt - prognos)", formatSEK(diff), {
    bold: true,
    color: diff >= 0 ? POSITIVE : NEGATIVE,
  });
  c.spacer();

  // 3. Topp 3 försenade kunder
  c.heading("Topp 3 försenade kunder");
  if (data.topOverdueCustomers.length === 0) {
    c.text("Inga försenade kundfakturor just nu.", { color: MUTED });
  } else {
    for (const cust of data.topOverdueCustomers) {
      c.row(
        `${cust.customerKey} (${cust.invoiceCount} faktura${cust.invoiceCount === 1 ? "" : "or"}, ${cust.maxDaysOverdue} dagar försenad)`,
        formatSEK(cust.totalOverdue),
      );
    }
  }
  c.spacer();

  // 4. Nästa månads prognos
  c.heading(`Nästa månads prognos — ${data.nextMonthLabel}`);
  c.row("Ingående saldo", formatSEK(data.nextMonth.startBalance));
  c.row("Utgående saldo (prognos)", formatSEK(data.nextMonth.endBalance));
  c.row("Lägsta saldo", `${formatSEK(data.nextMonth.minBalance)} (${data.nextMonth.minDate})`);
  if (data.nextMonth.breachDate) {
    c.text(
      `VARNING: saldot riskerar gå under varningsgränsen den ${data.nextMonth.breachDate} (${formatSEK(data.nextMonth.breachAmount ?? 0)}).`,
      { color: NEGATIVE, bold: true },
    );
  } else {
    c.text("Ingen varning inom nästa månad.", { color: POSITIVE });
  }
  c.spacer();

  // 5. Skattebetalningar som väntar
  c.heading("Skattebetalningar som väntar");
  if (data.upcomingTaxPayments.length === 0) {
    c.text("Inga kommande skattebetalningar inom perioden.", { color: MUTED });
  } else {
    for (const tax of data.upcomingTaxPayments) {
      c.row(
        `${tax.description} — ${tax.due_date}`,
        tax.amount > 0 ? formatSEK(tax.amount) : "Belopp okänt",
      );
    }
  }

  c.spacer(20);
  c.rule();
  c.paragraph(
    "Pejl ger dig och din redovisningskonsult en gemensam bild av likviditeten framåt — baserat på bokförd data i Fortnox. Ersätter inte bokföring eller rådgivning.",
  );

  return doc.save();
}
