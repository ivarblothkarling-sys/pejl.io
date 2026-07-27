import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeForecast,
  computeSuggestions,
  extractCustomerKey,
  formatSEK,
  type Tx,
} from "@/lib/forecast";
import { computeTaxEvents } from "@/lib/tax";

export const getDashboardData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { ensureUserBootstrap } = await import("@/lib/userBootstrap.server");
    const { primaryCompanyId } = await ensureUserBootstrap({
      supabase,
      userId,
      claims: context.claims,
    });

    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const profile = await resolveCompany(supabase, userId, data.companyId ?? primaryCompanyId);

    const { data: txData, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("company_id", profile.id)
      .order("due_date", { ascending: true });
    if (txError) throw new Error(txError.message);

    const country = (profile as { country?: string }).country ?? "SE";
    const vatPeriod = (profile as { vat_period?: string }).vat_period ?? "monthly";
    const includePending = Boolean(
      (profile as { include_pending_in_forecast?: boolean }).include_pending_in_forecast,
    );
    const rawTxs = (txData ?? []) as Tx[];

    // Summera obetalda leverantörsfakturor per attest-status (SEK).
    const approvedPendingSum = rawTxs
      .filter(
        (t) => t.kind === "expense" && !t.paid && (t.approval_status ?? "approved") === "approved",
      )
      .reduce((s, t) => s + Number(t.amount), 0);
    const awaitingApprovalSum = rawTxs
      .filter((t) => t.kind === "expense" && !t.paid && t.approval_status === "pending_approval")
      .reduce((s, t) => s + Number(t.amount), 0);

    // Filtrera bort attest-fakturor från prognosen om användaren inte vill räkna med dem.
    const forecastInput = includePending
      ? rawTxs
      : rawTxs.filter((t) => (t.approval_status ?? "approved") !== "pending_approval");

    const transactions = [
      ...forecastInput,
      ...computeTaxEvents(
        country as "SE" | "NO" | "GB" | "US",
        new Date(),
        30,
        vatPeriod as "monthly" | "quarterly" | "yearly",
      ),
    ].sort((a, b) => a.due_date.localeCompare(b.due_date));

    const monthlyRevenueTarget = (profile as { monthly_revenue_target?: number | null })
      .monthly_revenue_target;
    const forecast = computeForecast(
      Number(profile.current_balance) || 0,
      Number(profile.threshold) || 0,
      transactions,
      30,
      new Date(),
      country as "SE" | "NO" | "GB" | "US",
      vatPeriod as "monthly" | "quarterly" | "yearly",
      monthlyRevenueTarget != null ? Number(monthlyRevenueTarget) : null,
    );
    const suggestions = computeSuggestions(forecast, transactions);

    // Fire-and-forget: skicka mejlvarning om saldot bryter gränsen (throttlat per breach-datum)
    if (forecast.breachDate) {
      const p = profile as {
        last_low_balance_alert_key?: string | null;
        company_name?: string | null;
      };
      const alertKey = `${forecast.breachDate}:${Math.round(forecast.breachAmount ?? 0)}`;
      if (p.last_low_balance_alert_key !== alertKey) {
        // Skapa alltid en in-app-notis vid en ny gränsöverträdelse, oavsett
        // om mejlet nedan går att skicka (t.ex. saknad RESEND_API_KEY eller
        // ingen e-post i claims).
        try {
          const { createNotification } = await import("@/lib/api/notifications.functions");
          await createNotification({
            userId,
            type: "forecast_warning",
            title: "Saldot riskerar gå under din gräns",
            body: `Prognosen visar att saldot går under din varningsgräns ${forecast.breachDate}.`,
          });
        } catch (err) {
          console.error("[finance] notification create failed", err);
        }

        const email = context.claims?.email as string | undefined;
        if (email) {
          try {
            const { sendLowBalanceEmail } = await import("@/lib/emailAlert.server");
            const result = await sendLowBalanceEmail({
              to: email,
              companyName: p.company_name ?? "Ditt företag",
              forecast,
            });
            if (result.ok) {
              await supabase
                .from("user_companies")
                .update({
                  last_low_balance_alert_at: new Date().toISOString(),
                  last_low_balance_alert_key: alertKey,
                })
                .eq("id", profile.id);
            }
          } catch (err) {
            console.error("[finance] email alert failed", err);
          }
        }
      }
    }

    return {
      profile,
      transactions,
      forecast,
      suggestions,
      approvedPendingSum,
      awaitingApprovalSum,
      includePendingInForecast: includePending,
      companyId: profile.id,
    };
  });

/**
 * Konsoliderad vy — summerar kassaflödesprognosen för ANVÄNDARENS alla aktiva
 * bolag. Kör en fristående computeForecast per bolag (varje bolag har egen
 * valuta/land/momsperiod/saldo) och summerar sedan dagsbalanserna. Returnerar
 * en enklare punktform (date/balance) än ForecastPoint eftersom "vilka
 * händelser låg bakom dagens summa" inte är meningsfullt över flera bolag —
 * per-bolagsnedbrytningen (perCompany) täcker det behovet istället.
 */
export const getConsolidatedDashboardData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { ensureUserBootstrap } = await import("@/lib/userBootstrap.server");
    await ensureUserBootstrap({ supabase, userId, claims: context.claims });

    const { data: companiesData, error: companiesErr } = await supabase
      .from("user_companies")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("is_primary", { ascending: false });
    if (companiesErr) throw new Error(companiesErr.message);
    const companies = companiesData ?? [];
    if (companies.length === 0) {
      return {
        perCompany: [],
        points: [],
        totalStartBalance: 0,
        totalThreshold: 0,
        totalMinBalance: 0,
        totalMinDate: null,
        totalBreachDate: null,
      };
    }

    const companyIds = companies.map((c) => c.id);
    const { data: txData, error: txErr } = await supabase
      .from("transactions")
      .select("*")
      .in("company_id", companyIds);
    if (txErr) throw new Error(txErr.message);
    const txsByCompany = new Map<string, Tx[]>();
    for (const t of (txData ?? []) as (Tx & { company_id: string | null })[]) {
      if (!t.company_id) continue;
      const list = txsByCompany.get(t.company_id);
      if (list) list.push(t);
      else txsByCompany.set(t.company_id, [t]);
    }

    const perCompanyForecasts = companies.map((company) => {
      const rawTxs = txsByCompany.get(company.id) ?? [];
      const includePending = Boolean(company.include_pending_in_forecast);
      const forecastInput = includePending
        ? rawTxs
        : rawTxs.filter((t) => (t.approval_status ?? "approved") !== "pending_approval");
      const country = (company.country ?? "SE") as "SE" | "NO" | "GB" | "US";
      const vatPeriod = (company.vat_period ?? "monthly") as "monthly" | "quarterly" | "yearly";
      const transactions = [
        ...forecastInput,
        ...computeTaxEvents(country, new Date(), 30, vatPeriod),
      ].sort((a, b) => a.due_date.localeCompare(b.due_date));
      const forecast = computeForecast(
        Number(company.current_balance) || 0,
        Number(company.threshold) || 0,
        transactions,
        30,
        new Date(),
        country,
        vatPeriod,
      );
      return { company, forecast };
    });

    const pointCount = perCompanyForecasts[0].forecast.points.length;
    const points = Array.from({ length: pointCount }, (_, i) => {
      const date = perCompanyForecasts[0].forecast.points[i].date;
      const balance = perCompanyForecasts.reduce(
        (sum, { forecast }) => sum + (forecast.points[i]?.balance ?? 0),
        0,
      );
      return { date, balance: Math.round(balance * 100) / 100 };
    });

    const totalStartBalance = perCompanyForecasts.reduce(
      (s, { forecast }) => s + forecast.startBalance,
      0,
    );
    const totalThreshold = perCompanyForecasts.reduce(
      (s, { forecast }) => s + forecast.threshold,
      0,
    );
    let totalMinBalance = points[0]?.balance ?? 0;
    let totalMinDate = points[0]?.date ?? null;
    for (const p of points) {
      if (p.balance < totalMinBalance) {
        totalMinBalance = p.balance;
        totalMinDate = p.date;
      }
    }
    const breach = points.find((p) => p.balance < totalThreshold) ?? null;

    return {
      perCompany: perCompanyForecasts.map(({ company, forecast }) => ({
        companyId: company.id,
        companyName: company.company_name,
        currency: company.currency,
        currentBalance: forecast.startBalance,
        minBalance: forecast.minBalance,
        minDate: forecast.minDate,
        breachDate: forecast.breachDate,
      })),
      points,
      totalStartBalance: Math.round(totalStartBalance * 100) / 100,
      totalThreshold: Math.round(totalThreshold * 100) / 100,
      totalMinBalance: Math.round(totalMinBalance * 100) / 100,
      totalMinDate,
      totalBreachDate: breach?.date ?? null,
    };
  });

export const updatePendingApprovalPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ include: z.boolean(), companyId: z.string().uuid().optional() }))
  .handler(async ({ data, context }) => {
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const company = await resolveCompany(context.supabase, context.userId, data.companyId);
    const { error } = await context.supabase
      .from("user_companies")
      .update({ include_pending_in_forecast: data.include, updated_at: new Date().toISOString() })
      .eq("id", company.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ threshold: z.number().min(0), companyId: z.string().uuid().optional() }),
  )
  .handler(async ({ data, context }) => {
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const company = await resolveCompany(context.supabase, context.userId, data.companyId);
    const { error } = await context.supabase
      .from("user_companies")
      .update({ threshold: data.threshold, updated_at: new Date().toISOString() })
      .eq("id", company.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** target: null nollställer målet (döljer progress-baren i dashboarden). */
export const updateMonthlyRevenueTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ target: z.number().min(0).nullable(), companyId: z.string().uuid().optional() }),
  )
  .handler(async ({ data, context }) => {
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const company = await resolveCompany(context.supabase, context.userId, data.companyId);
    const { error } = await context.supabase
      .from("user_companies")
      .update({ monthly_revenue_target: data.target, updated_at: new Date().toISOString() })
      .eq("id", company.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Bygger veckosammanfattningen (prognos + AI-genererad text) för en användare.
 * Ren datafunktion — tar redan hämtad profil/transaktioner så den kan
 * återanvändas både från den user-scoped createServerFn nedan och från det
 * schemalagda veckobrevet (som läser via supabaseAdmin, se
 * weeklySummaryDigest.server.ts) utan att duplicera prognos/prompt-logiken.
 */
export async function buildWeeklySummary(
  profile: {
    company_name?: string | null;
    current_balance?: number | null;
    threshold?: number | null;
    country?: string | null;
    vat_period?: string | null;
  },
  rawTxs: Tx[],
) {
  const country = profile.country ?? "SE";
  const vatPeriod = profile.vat_period ?? "monthly";
  const txs = [
    ...rawTxs,
    ...computeTaxEvents(
      country as "SE" | "NO" | "GB" | "US",
      new Date(),
      30,
      vatPeriod as "monthly" | "quarterly" | "yearly",
    ),
  ].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const forecast = computeForecast(
    Number(profile.current_balance) || 0,
    Number(profile.threshold) || 0,
    txs,
    30,
    new Date(),
    country as "SE" | "NO" | "GB" | "US",
    vatPeriod as "monthly" | "quarterly" | "yearly",
  );

  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI är inte konfigurerad");

  const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
  const { generateText } = await import("ai");
  const gateway = createLovableAiGatewayProvider(key);

  const breachText = forecast.breachDate
    ? `Varning: saldot går under gränsen ${formatSEK(forecast.threshold)} den ${forecast.breachDate} (då ca ${formatSEK(forecast.breachAmount ?? 0)}).`
    : `Inga varningar — saldot håller sig över gränsen ${formatSEK(forecast.threshold)} hela perioden.`;

  const prompt = `Du är Pejl — en pragmatisk ekonomiassistent för svenska småföretagare.
Skriv en kort, vänlig veckosammanfattning (max 6 meningar, på svenska) baserat på datan nedan.
Lyft fram dagens saldo, lägsta saldot kommande 30 dagar, eventuell varning, samt 1–2 konkreta råd.

Företag: ${profile.company_name ?? "ditt företag"}
Dagens saldo: ${formatSEK(forecast.startBalance)}
Prognos om 30 dagar: ${formatSEK(forecast.endBalance)}
Lägsta saldo: ${formatSEK(forecast.minBalance)} (${forecast.minDate})
${breachText}

Kommande transaktioner (datum, typ, belopp, beskrivning):
${txs
  .filter((t) => !t.paid)
  .slice(0, 20)
  .map(
    (t) =>
      `- ${t.due_date} | ${t.kind === "income" ? "IN " : "UT "} | ${formatSEK(Number(t.amount))} | ${t.description}`,
  )
  .join("\n")}`;

  const { text } = await generateText({
    model: gateway("google/gemini-3-flash-preview"),
    prompt,
  });

  return { summary: text, forecast };
}

export const generateWeeklySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const profile = await resolveCompany(supabase, userId, data.companyId);

    const { data: txData, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("company_id", profile.id);
    if (txError) throw new Error(txError.message);

    return buildWeeklySummary(profile, (txData ?? []) as Tx[]);
  });

// ---------------------------------------------------------------------------
// simulateScenario — "vad händer om"-simulering ovanpå den riktiga prognosen
// ---------------------------------------------------------------------------

const SIMULATION_DAYS = 30;

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsIso(dateIso: string, months: number): string {
  const d = new Date(dateIso);
  const originalDay = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Om målmånaden har färre dagar än ursprungsdagen (t.ex. 31 jan + 1 månad,
  // februari har ingen 31:a) rullar setUTCMonth över till nästa månad —
  // klampa till målmånadens sista dag istället.
  if (d.getUTCDate() !== originalDay) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Obetald transaktion av rätt typ, inte redan förfallen, med due_date närmast targetDateIso. */
function closestUpcomingUnpaidTx(
  transactions: Tx[],
  kind: "income" | "expense",
  targetDateIso: string,
  todayUtcMs: number,
): Tx | null {
  const targetMs = new Date(targetDateIso).getTime();
  let best: Tx | null = null;
  let bestDiff = Infinity;
  for (const t of transactions) {
    if (t.kind !== kind || t.paid) continue;
    const dueMs = new Date(t.due_date).getTime();
    if (dueMs < todayUtcMs) continue;
    const diff = Math.abs(dueMs - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return best;
}

type SimulationAction = "hire" | "new_client" | "delay_payment" | "early_invoice";

/**
 * Bygger den simulerade transaktionslistan för ett scenario. Rör aldrig den
 * riktiga listan — returnerar alltid en ny array (nya/ändrade rader kopieras,
 * oförändrade rader återanvänds som de är).
 */
function applyScenario(
  transactions: Tx[],
  action: SimulationAction,
  amount: number,
  dateIso: string,
  fromDate: Date,
): Tx[] {
  const todayUtcMs = Date.UTC(
    fromDate.getUTCFullYear(),
    fromDate.getUTCMonth(),
    fromDate.getUTCDate(),
  );
  const windowEndMs = todayUtcMs + SIMULATION_DAYS * 86_400_000;

  switch (action) {
    case "hire": {
      // Återkommande månadskostnad från dateIso — genererar varje förekomst
      // som hamnar inom prognosfönstret (typiskt 1, ibland 2 om dateIso
      // ligger tidigt i fönstret).
      const extra: Tx[] = [];
      let occurrence = dateIso;
      let iterations = 0;
      while (new Date(occurrence).getTime() <= windowEndMs && iterations < 12) {
        if (new Date(occurrence).getTime() >= todayUtcMs) {
          extra.push({
            id: `sim-hire-${iterations}`,
            kind: "expense",
            amount,
            due_date: occurrence,
            description: "Simulerad nyanställning (lön)",
            paid: false,
          });
        }
        occurrence = addMonthsIso(occurrence, 1);
        iterations++;
      }
      return [...transactions, ...extra];
    }
    case "new_client":
      return [
        ...transactions,
        {
          id: "sim-new-client",
          kind: "income",
          amount,
          due_date: dateIso,
          description: "Simulerad ny kund",
          paid: false,
        },
      ];
    case "delay_payment": {
      const target = closestUpcomingUnpaidTx(transactions, "income", dateIso, todayUtcMs);
      if (!target) {
        throw new Error("Ingen kommande obetald kundfaktura hittades att simulera förseningen på.");
      }
      return transactions.map((t) =>
        t.id === target.id ? { ...t, due_date: addDaysIso(t.due_date, 14) } : t,
      );
    }
    case "early_invoice": {
      const target = closestUpcomingUnpaidTx(transactions, "expense", dateIso, todayUtcMs);
      if (!target) {
        throw new Error("Ingen kommande obetald leverantörsfaktura hittades att simulera på.");
      }
      return transactions.map((t) =>
        t.id === target.id ? { ...t, due_date: addDaysIso(t.due_date, -7) } : t,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// getCustomerRisk — kreditrisk per kund baserat på faktisk betalningshistorik
// ---------------------------------------------------------------------------

const MIN_RISK_SAMPLES = 3;
const RISK_DAY_MS = 86_400_000;

export type CustomerRiskLevel = "green" | "yellow" | "red";

export type CustomerRisk = {
  customerKey: string;
  avgDelayDays: number;
  lateRatio: number;
  sampleSize: number;
  riskLevel: CustomerRiskLevel;
};

function classifyCustomerRisk(avgDelayDays: number, lateRatio: number): CustomerRiskLevel {
  if (avgDelayDays > 10 || lateRatio > 0.5) return "red";
  if (avgDelayDays <= 3) return "green";
  return "yellow";
}

/**
 * Grupperar betalda kundfakturor per kund med samma extractCustomerKey-
 * heuristik som analyzeCustomerPaymentDelay i forecast.ts (matchar Fortnox-
 * mönstret "Kundfaktura #123 — Kundnamn AB"), så de två inte kan drifta isär.
 * Kunder med färre än MIN_RISK_SAMPLES betalda fakturor utelämnas helt —
 * för litet underlag för en riskbedömning.
 */
export function computeCustomerRisk(
  paidIncome: { description: string; due_date: string; paid_at: string }[],
): CustomerRisk[] {
  const byCustomer = new Map<string, { due_date: string; paid_at: string }[]>();
  for (const t of paidIncome) {
    const key = extractCustomerKey(t.description);
    const list = byCustomer.get(key);
    if (list) list.push(t);
    else byCustomer.set(key, [t]);
  }

  const risks: CustomerRisk[] = [];
  for (const [customerKey, txs] of byCustomer) {
    if (txs.length < MIN_RISK_SAMPLES) continue;
    const delays = txs.map(
      (t) => (new Date(t.paid_at).getTime() - new Date(t.due_date).getTime()) / RISK_DAY_MS,
    );
    const avgDelayDays = Math.round((delays.reduce((s, d) => s + d, 0) / delays.length) * 10) / 10;
    const lateRatio = Math.round((delays.filter((d) => d > 0).length / delays.length) * 100) / 100;
    risks.push({
      customerKey,
      avgDelayDays,
      lateRatio,
      sampleSize: txs.length,
      riskLevel: classifyCustomerRisk(avgDelayDays, lateRatio),
    });
  }
  return risks.sort((a, b) => b.avgDelayDays - a.avgDelayDays);
}

export const getCustomerRisk = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string } | undefined) => input ?? {})
  .handler(async ({ data: input, context }) => {
    const { supabase, userId } = context;
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const company = await resolveCompany(supabase, userId, input.companyId);

    const { data, error } = await supabase
      .from("transactions")
      .select("description, due_date, paid_at")
      .eq("company_id", company.id)
      .eq("kind", "income")
      .not("paid_at", "is", null);
    if (error) throw new Error(error.message);

    return computeCustomerRisk(
      (data ?? []) as { description: string; due_date: string; paid_at: string }[],
    );
  });

export const simulateScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      action: z.enum(["hire", "new_client", "delay_payment", "early_invoice"]),
      amount: z.number().min(0),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      companyId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const profile = await resolveCompany(supabase, userId, data.companyId);

    const { data: txData, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("company_id", profile.id)
      .order("due_date", { ascending: true });
    if (txError) throw new Error(txError.message);

    const country = (profile as { country?: string }).country ?? "SE";
    const vatPeriod = (profile as { vat_period?: string }).vat_period ?? "monthly";
    const includePending = Boolean(
      (profile as { include_pending_in_forecast?: boolean }).include_pending_in_forecast,
    );
    const rawTxs = (txData ?? []) as Tx[];

    // Samma uppbyggnad av transaktionslistan som getDashboardData (skatter +
    // attest-filter) — annars matchar inte original_forecast den prognos som
    // faktiskt visas i dashboardens graf, och overlayn blir missvisande.
    const forecastInput = includePending
      ? rawTxs
      : rawTxs.filter((t) => (t.approval_status ?? "approved") !== "pending_approval");
    const baseTransactions = [
      ...forecastInput,
      ...computeTaxEvents(
        country as "SE" | "NO" | "GB" | "US",
        new Date(),
        SIMULATION_DAYS,
        vatPeriod as "monthly" | "quarterly" | "yearly",
      ),
    ].sort((a, b) => a.due_date.localeCompare(b.due_date));

    const startBalance = Number(profile.current_balance) || 0;
    const threshold = Number(profile.threshold) || 0;
    const fromDate = new Date();

    const simulatedTransactions = applyScenario(
      baseTransactions,
      data.action,
      data.amount,
      data.date,
      fromDate,
    );

    const originalForecast = computeForecast(
      startBalance,
      threshold,
      baseTransactions,
      SIMULATION_DAYS,
      fromDate,
      country as "SE" | "NO" | "GB" | "US",
      vatPeriod as "monthly" | "quarterly" | "yearly",
    );
    const simulatedForecast = computeForecast(
      startBalance,
      threshold,
      simulatedTransactions,
      SIMULATION_DAYS,
      fromDate,
      country as "SE" | "NO" | "GB" | "US",
      vatPeriod as "monthly" | "quarterly" | "yearly",
    );

    const difference = originalForecast.points.map((p, i) => ({
      date: p.date,
      diff:
        Math.round(((simulatedForecast.points[i]?.balance ?? p.balance) - p.balance) * 100) / 100,
    }));

    const minDiff =
      Math.round((simulatedForecast.minBalance - originalForecast.minBalance) * 100) / 100;
    const summary =
      minDiff === 0
        ? `Åtgärden påverkar inte lägsta saldot — oförändrat ${formatSEK(simulatedForecast.minBalance)} den ${simulatedForecast.minDate}.`
        : `Åtgärden ${minDiff > 0 ? "förbättrar" : "försämrar"} lägsta saldot med ${formatSEK(Math.abs(minDiff))} den ${simulatedForecast.minDate}.`;

    return {
      original_forecast: originalForecast.points,
      simulated_forecast: simulatedForecast.points,
      difference,
      summary,
    };
  });

/**
 * Genererar den månatliga PDF-rapporten för INLOGGAD användares senast
 * avslutade kalendermånad. Base64:as i svaret — server functions serialiseras
 * via TanStack Starts egna RPC-protokoll (seroval), inte som en rå binär
 * HTTP-respons, så det är samma mönster som exportTransactionsCsv redan
 * använder för CSV-nedladdning, bara med binärdata istället för text.
 */
export const getMonthlyReportPdf = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string } | undefined) => input ?? {})
  .handler(async ({ data: input, context }) => {
    const { supabase, userId } = context;
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const profile = await resolveCompany(supabase, userId, input.companyId);

    const { data: txData, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("company_id", profile.id);
    if (txError) throw new Error(txError.message);

    const { buildMonthlyReportData, renderMonthlyReportPdf } = await import("@/lib/report.server");
    const reportData = buildMonthlyReportData(profile, (txData ?? []) as Tx[]);
    const pdfBytes = await renderMonthlyReportPdf(reportData);

    return {
      pdfBase64: Buffer.from(pdfBytes).toString("base64"),
      filename: `pejl-manadsrapport-${reportData.periodStart.slice(0, 7)}.pdf`,
    };
  });

/**
 * Skickar en betalningspåminnelse till en SLUTKUND för en specifik försenad
 * kundfaktura. Kräver att fakturan kommer från Fortnox (external_id =
 * "inv-<DocumentNumber>") — mock-/SIE-data har ingen riktig kund att slå
 * upp e-post för, och det är bättre att ge ett tydligt fel än att låtsas
 * att det fungerar.
 *
 * Returnerar samma form som simulateScenario (original_forecast/
 * simulated_forecast/difference/summary) — inte bara "updated_forecast" —
 * så dashboarden kan återanvända sin befintliga simuleringsgraf rakt av
 * istället för att bygga en ny overlay bara för det här flödet.
 */
export const sendPaymentReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ transactionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", data.transactionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (txErr) throw new Error(txErr.message);
    if (!tx) throw new Error("Fakturan hittades inte.");
    if (tx.kind !== "income") throw new Error("Bara kundfakturor kan få en betalningspåminnelse.");
    if (tx.paid) throw new Error("Fakturan är redan markerad som betald.");
    if (tx.source !== "fortnox" || !tx.external_id || !tx.external_id.startsWith("inv-")) {
      throw new Error(
        "Kan bara skicka påminnelser för kundfakturor synkade från Fortnox — den här saknar en Fortnox-koppling.",
      );
    }
    if (!tx.company_id) throw new Error("Fakturan är inte kopplad till något bolag.");
    const documentNumber = tx.external_id.slice("inv-".length);

    const [{ data: conn, error: connErr }, { data: profile, error: profileErr }] =
      await Promise.all([
        supabase
          .from("fortnox_connections")
          .select("access_token, refresh_token, expires_at, scope")
          .eq("company_id", tx.company_id)
          .maybeSingle(),
        supabase.from("user_companies").select("*").eq("id", tx.company_id).maybeSingle(),
      ]);
    if (connErr) throw new Error(connErr.message);
    if (!conn) throw new Error("Ingen aktiv Fortnox-koppling hittades.");
    if (profileErr) throw new Error(profileErr.message);

    const { ensureFreshFortnoxToken, fetchFortnoxCustomerEmailForInvoice } =
      await import("@/lib/fortnoxApi.server");
    const accessToken = await ensureFreshFortnoxToken({ ...conn, user_id: userId });
    const { email, customerName } = await fetchFortnoxCustomerEmailForInvoice(
      accessToken,
      documentNumber,
    );
    if (!email) {
      throw new Error(
        `Kunde inte hitta en e-postadress för kunden på faktura ${documentNumber} i Fortnox.`,
      );
    }

    const { data: userRes } = await supabase.auth.getUser();
    const companyName = profile?.company_name ?? "Ditt företag";

    const { sendInvoiceReminderEmail } = await import("@/lib/emailAlert.server");
    const emailResult = await sendInvoiceReminderEmail({
      to: email,
      customerName: customerName ?? "kund",
      companyName,
      invoiceNumber: documentNumber,
      amount: Number(tx.amount),
      dueDate: tx.due_date,
      replyTo: userRes.user?.email ?? null,
    });
    if (!emailResult.ok) {
      throw new Error(`Kunde inte skicka mejlet (${emailResult.error}).`);
    }

    const sentAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("transactions")
      .update({ reminder_sent_at: sentAt })
      .eq("id", tx.id);
    if (updateErr) throw new Error(updateErr.message);

    try {
      const { createNotification } = await import("@/lib/api/notifications.functions");
      await createNotification({
        userId,
        type: "payment_reminder_sent",
        title: `Påminnelse skickad — faktura ${documentNumber}`,
        body: `${formatSEK(Number(tx.amount))} till ${customerName ?? "kund"} (${email}), ursprungligt förfallodatum ${tx.due_date}.`,
        relatedId: tx.id,
      });
    } catch (notifErr) {
      console.error("[finance] Kunde inte skapa notis för skickad påminnelse:", notifErr);
    }

    // Uppdaterad prognos: hur mycket bättre lägsta saldot blir OM kunden
    // betalar inom 7 dagar.
    const { data: allTxRows, error: allTxErr } = await supabase
      .from("transactions")
      .select("*")
      .eq("company_id", tx.company_id);
    if (allTxErr) throw new Error(allTxErr.message);
    const allTxs = (allTxRows ?? []) as Tx[];
    const includePending = Boolean(
      (profile as { include_pending_in_forecast?: boolean } | null)?.include_pending_in_forecast,
    );
    const forecastInput = includePending
      ? allTxs
      : allTxs.filter((t) => (t.approval_status ?? "approved") !== "pending_approval");
    const country = ((profile as { country?: string } | null)?.country ?? "SE") as
      "SE" | "NO" | "GB" | "US";
    const vatPeriod = ((profile as { vat_period?: string } | null)?.vat_period ?? "monthly") as
      "monthly" | "quarterly" | "yearly";
    const startBalance = Number(profile?.current_balance) || 0;
    const threshold = Number(profile?.threshold) || 0;
    const fromDate = new Date();

    const originalForecast = computeForecast(
      startBalance,
      threshold,
      forecastInput,
      30,
      fromDate,
      country,
      vatPeriod,
    );

    const paysWithin7Days = new Date(fromDate);
    paysWithin7Days.setUTCDate(paysWithin7Days.getUTCDate() + 7);
    const paysWithin7DaysIso = paysWithin7Days.toISOString().slice(0, 10);
    const simulatedTxs = forecastInput.map((t) =>
      t.id === tx.id ? { ...t, due_date: paysWithin7DaysIso } : t,
    );
    const simulatedForecast = computeForecast(
      startBalance,
      threshold,
      simulatedTxs,
      30,
      fromDate,
      country,
      vatPeriod,
    );

    const difference = originalForecast.points.map((p, i) => ({
      date: p.date,
      diff:
        Math.round(((simulatedForecast.points[i]?.balance ?? p.balance) - p.balance) * 100) / 100,
    }));
    const minDiff =
      Math.round((simulatedForecast.minBalance - originalForecast.minBalance) * 100) / 100;
    const summary =
      minDiff <= 0
        ? `Påminnelse skickad till ${customerName ?? "kunden"}. Den här fakturan påverkar inte lägsta saldot i prognosen, så en betalning inom 7 dagar förändrar det inte ytterligare.`
        : `Påminnelse skickad till ${customerName ?? "kunden"}. Om fakturan betalas inom 7 dagar förbättras lägsta saldot med ${formatSEK(minDiff)} den ${simulatedForecast.minDate}.`;

    return {
      ok: true as const,
      sentTo: email,
      reminderSentAt: sentAt,
      original_forecast: originalForecast.points,
      simulated_forecast: simulatedForecast.points,
      difference,
      summary,
    };
  });
