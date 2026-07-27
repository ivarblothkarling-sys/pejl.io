import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeForecast, type ForecastResult, type Tx } from "@/lib/forecast";
import { computeTaxEvents, type Country, type VatPeriod } from "@/lib/tax";

const shareViewTypeEnum = z.enum(["dashboard", "investor"]);
export type ShareViewType = z.infer<typeof shareViewTypeEnum>;

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { viewType?: ShareViewType } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const viewType = data.viewType ?? "dashboard";
    const token = crypto.randomUUID().replace(/-/g, "");
    // expires_at sätts av kolumnens DEFAULT (now() + 30 dagar) — läs tillbaka
    // det faktiska värdet istället för att räkna ut det själv på klienten.
    const { data: inserted, error } = await context.supabase
      .from("share_tokens")
      .insert({ token, user_id: context.userId, view_type: viewType })
      .select("expires_at")
      .single();
    if (error) throw new Error(error.message);
    return { token, expiresAt: inserted.expires_at, viewType };
  });

export const getActiveShareLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("share_tokens")
      .select("token, created_at, expires_at, view_type")
      .eq("user_id", context.userId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { links: data ?? [] };
  });

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ token: z.string().min(8).max(64) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("share_tokens")
      .delete()
      .eq("token", data.token)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Investerarvy — förenklade, aggregerade siffror. Skickar ALDRIG den
// itemiserade transaktionslistan till klienten (till skillnad från
// dashboard-vyn) — det är hela poängen med "utan fakturadetaljer".
// ---------------------------------------------------------------------------

const INVESTOR_FORECAST_DAYS = 90;
const BURN_WINDOW_MONTHS = 3;
const MOM_WINDOW_MONTHS = 6;

export type InvestorMonthlyBreakdown = {
  month: string;
  income: number;
  expense: number;
  incomeMomPct: number | null;
  expenseMomPct: number | null;
};

export type InvestorMetrics = {
  currentBalance: number;
  avgMonthlyExpense: number;
  netBurnPerMonth: number;
  runwayMonths: number | null;
  forecast: ForecastResult;
  monthlyBreakdown: InvestorMonthlyBreakdown[];
};

/**
 * Beräknar månadsvisa summor från due_date (inte paid_at) — transactions
 * innehåller inte garanterat en fullständig historik längre bak än några
 * månader (Fortnox-synken hämtar bara öppna + nyligen betalda fakturor), så
 * de här siffrorna är bästa möjliga approximation utifrån vad som faktiskt
 * finns i tabellen, inte en fullständig bokförd historik.
 */
function buildInvestorMetrics(
  currentBalance: number,
  threshold: number,
  rawTxs: Tx[],
  country: Country,
  vatPeriod: VatPeriod,
): InvestorMetrics {
  const today = new Date();

  // 7 månadsnycklar (YYYY-MM), äldst till nyast — den första används bara
  // som jämförelsepunkt för MoM% på den andra.
  const monthKeys: string[] = [];
  for (let i = MOM_WINDOW_MONTHS; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    monthKeys.push(d.toISOString().slice(0, 7));
  }

  const incomeByMonth = new Map<string, number>(monthKeys.map((m) => [m, 0]));
  const expenseByMonth = new Map<string, number>(monthKeys.map((m) => [m, 0]));
  for (const t of rawTxs) {
    const key = t.due_date.slice(0, 7);
    if (!incomeByMonth.has(key)) continue;
    if (t.kind === "income")
      incomeByMonth.set(key, (incomeByMonth.get(key) ?? 0) + Number(t.amount));
    else expenseByMonth.set(key, (expenseByMonth.get(key) ?? 0) + Number(t.amount));
  }

  const monthlyBreakdown: InvestorMonthlyBreakdown[] = monthKeys.slice(1).map((month, i) => {
    const prevMonth = monthKeys[i];
    const income = incomeByMonth.get(month) ?? 0;
    const expense = expenseByMonth.get(month) ?? 0;
    const prevIncome = incomeByMonth.get(prevMonth) ?? 0;
    const prevExpense = expenseByMonth.get(prevMonth) ?? 0;
    const incomeMomPct =
      prevIncome > 0 ? Math.round(((income - prevIncome) / prevIncome) * 1000) / 10 : null;
    const expenseMomPct =
      prevExpense > 0 ? Math.round(((expense - prevExpense) / prevExpense) * 1000) / 10 : null;
    return { month, income, expense, incomeMomPct, expenseMomPct };
  });

  // Burn rate/runway: snitt över de senaste BURN_WINDOW_MONTHS hela
  // kalendermånaderna (inkl. innevarande, ofullständiga månad — en
  // approximation, se kommentaren ovan).
  const burnMonths = monthKeys.slice(-BURN_WINDOW_MONTHS);
  const avgMonthlyExpense =
    burnMonths.reduce((sum, m) => sum + (expenseByMonth.get(m) ?? 0), 0) / burnMonths.length;
  const avgMonthlyIncome =
    burnMonths.reduce((sum, m) => sum + (incomeByMonth.get(m) ?? 0), 0) / burnMonths.length;
  const netBurnPerMonth = avgMonthlyExpense - avgMonthlyIncome;
  const runwayMonths = avgMonthlyExpense > 0 ? currentBalance / avgMonthlyExpense : null;

  const transactions = [
    ...rawTxs,
    ...computeTaxEvents(country, today, INVESTOR_FORECAST_DAYS, vatPeriod),
  ].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const forecast = computeForecast(
    currentBalance,
    threshold,
    transactions,
    INVESTOR_FORECAST_DAYS,
    today,
    country,
    vatPeriod,
  );

  return {
    currentBalance,
    avgMonthlyExpense: Math.round(avgMonthlyExpense),
    netBurnPerMonth: Math.round(netBurnPerMonth),
    runwayMonths: runwayMonths != null ? Math.round(runwayMonths * 10) / 10 : null,
    forecast,
    monthlyBreakdown,
  };
}

export const getSharedDashboard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string().min(8).max(64) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: tokenErr } = await supabaseAdmin
      .from("share_tokens")
      .select("user_id, expires_at, view_type")
      .eq("token", data.token)
      .maybeSingle();
    if (tokenErr) throw new Error(tokenErr.message);
    if (!row) throw notFound();
    if (row.expires_at && new Date(row.expires_at) < new Date()) throw notFound();

    const userId = row.user_id as string;
    // share_tokens är inte bolagsspecifik — delar alltid användarens PRIMÄRA
    // bolag (matchar dashboardens default-vy innan en användare aktivt byter
    // bolag i väljaren).
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const profile = await resolveCompany(supabaseAdmin, userId, null);
    const { data: txData, error: txError } = await supabaseAdmin
      .from("transactions")
      .select("*")
      .eq("company_id", profile.id)
      .order("due_date", { ascending: true });
    if (txError) throw new Error(txError.message);

    const country = ((profile as { country?: string }).country ?? "SE") as Country;
    const vatPeriod = ((profile as { vat_period?: string }).vat_period ?? "monthly") as VatPeriod;
    const rawTxs = (txData ?? []) as Tx[];
    const currentBalance = Number(profile.current_balance) || 0;
    const threshold = Number(profile.threshold) || 0;

    if (row.view_type === "investor") {
      const metrics = buildInvestorMetrics(currentBalance, threshold, rawTxs, country, vatPeriod);
      return {
        viewType: "investor" as const,
        companyName: profile.company_name ?? "Företaget",
        currency: profile.currency ?? "SEK",
        metrics,
      };
    }

    const transactions = [...rawTxs, ...computeTaxEvents(country, new Date(), 14, vatPeriod)].sort(
      (a, b) => a.due_date.localeCompare(b.due_date),
    );

    const forecast = computeForecast(
      currentBalance,
      threshold,
      transactions,
      14,
      new Date(),
      country,
      vatPeriod,
    );

    return { viewType: "dashboard" as const, profile, transactions, forecast };
  });
