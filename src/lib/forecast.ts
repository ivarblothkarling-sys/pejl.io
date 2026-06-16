export type Tx = {
  id: string;
  kind: "income" | "expense";
  amount: number;
  due_date: string; // YYYY-MM-DD
  description: string;
  paid: boolean;
  category?: "tax" | "regular";
};


export type ForecastPoint = {
  date: string;
  balance: number;
  delta: number;
  events: { description: string; amount: number; kind: "income" | "expense" }[];
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
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

export function computeForecast(
  startBalance: number,
  threshold: number,
  transactions: Tx[],
  days = 14,
  fromDate: Date = new Date(),
): ForecastResult {
  const start = new Date(fromDate);
  start.setHours(0, 0, 0, 0);

  const points: ForecastPoint[] = [];
  let balance = Number(startBalance) || 0;
  let breachDate: string | null = null;
  let breachAmount: number | null = null;
  let minBalance = balance;
  let minDate = fmtDate(start);

  // Day 0 = today, baseline
  points.push({
    date: fmtDate(start),
    balance,
    delta: 0,
    events: [],
  });

  for (let i = 1; i <= days; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = fmtDate(day);

    const todays = transactions.filter((t) => !t.paid && t.due_date === key);
    let delta = 0;
    const events = todays.map((t) => {
      const signed = t.kind === "income" ? Number(t.amount) : -Number(t.amount);
      delta += signed;
      return { description: t.description, amount: signed, kind: t.kind };
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
    points.push({ date: key, balance: Math.round(balance * 100) / 100, delta, events });
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
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n);

export const formatDateSv = (iso: string) =>
  new Date(iso).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });
