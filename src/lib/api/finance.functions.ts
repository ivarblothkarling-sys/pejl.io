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
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { ensureUserBootstrap } = await import("@/lib/userBootstrap.server");
    await ensureUserBootstrap({ supabase, userId, claims: context.claims });

    const [profileRes, txRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("due_date", { ascending: true }),
    ]);

    if (profileRes.error) throw new Error(profileRes.error.message);
    if (txRes.error) throw new Error(txRes.error.message);

    const profile = profileRes.data ?? { current_balance: 0, threshold: 0, company_name: "Mitt företag", country: "SE", currency: "SEK", language: "sv", accounting_provider: "fortnox", onboarding_completed: false, include_pending_in_forecast: false };
    const country = (profile as { country?: string }).country ?? "SE";
    const includePending = Boolean((profile as { include_pending_in_forecast?: boolean }).include_pending_in_forecast);
    const rawTxs = (txRes.data ?? []) as Tx[];

    // Summera obetalda leverantörsfakturor per attest-status (SEK).
    const approvedPendingSum = rawTxs
      .filter((t) => t.kind === "expense" && !t.paid && (t.approval_status ?? "approved") === "approved")
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
      ...computeTaxEvents(country as "SE" | "NO" | "GB" | "US"),
    ].sort((a, b) => a.due_date.localeCompare(b.due_date));

    const forecast = computeForecast(
      Number(profile.current_balance) || 0,
      Number(profile.threshold) || 0,
      transactions,
      30,
    );
    const suggestions = computeSuggestions(forecast, transactions);


    // Fire-and-forget: skicka mejlvarning om saldot bryter gränsen (throttlat per breach-datum)
    if (forecast.breachDate) {
      const p = profile as { last_low_balance_alert_key?: string | null; company_name?: string | null };
      const alertKey = `${forecast.breachDate}:${Math.round((forecast.breachAmount ?? 0))}`;
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
                .from("profiles")
                .update({
                  last_low_balance_alert_at: new Date().toISOString(),
                  last_low_balance_alert_key: alertKey,
                })
                .eq("id", userId);
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
    };
  });

export const updatePendingApprovalPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ include: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ include_pending_in_forecast: data.include, updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const updateThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ threshold: z.number().min(0) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert(
        { id: context.userId, threshold: data.threshold, updated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
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
  },
  rawTxs: Tx[],
) {
  const country = profile.country ?? "SE";
  const txs = [
    ...rawTxs,
    ...computeTaxEvents(country as "SE" | "NO" | "GB" | "US"),
  ].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const forecast = computeForecast(
    Number(profile.current_balance) || 0,
    Number(profile.threshold) || 0,
    txs,
    30,
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
  .map((t) => `- ${t.due_date} | ${t.kind === "income" ? "IN " : "UT "} | ${formatSEK(Number(t.amount))} | ${t.description}`)
  .join("\n")}`;

  const { text } = await generateText({
    model: gateway("google/gemini-3-flash-preview"),
    prompt,
  });

  return { summary: text, forecast };
}

export const generateWeeklySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profileRes, txRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("transactions").select("*").eq("user_id", userId),
    ]);
    if (profileRes.error) throw new Error(profileRes.error.message);
    if (txRes.error) throw new Error(txRes.error.message);

    const profile = profileRes.data ?? { current_balance: 0, threshold: 0, company_name: "ditt företag", country: "SE" };
    return buildWeeklySummary(profile, (txRes.data ?? []) as Tx[]);
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
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transactions")
      .select("description, due_date, paid_at")
      .eq("user_id", userId)
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
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [profileRes, txRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("due_date", { ascending: true }),
    ]);
    if (profileRes.error) throw new Error(profileRes.error.message);
    if (txRes.error) throw new Error(txRes.error.message);

    const profile = profileRes.data ?? {
      current_balance: 0,
      threshold: 0,
      country: "SE",
      include_pending_in_forecast: false,
    };
    const country = (profile as { country?: string }).country ?? "SE";
    const includePending = Boolean(
      (profile as { include_pending_in_forecast?: boolean }).include_pending_in_forecast,
    );
    const rawTxs = (txRes.data ?? []) as Tx[];

    // Samma uppbyggnad av transaktionslistan som getDashboardData (skatter +
    // attest-filter) — annars matchar inte original_forecast den prognos som
    // faktiskt visas i dashboardens graf, och overlayn blir missvisande.
    const forecastInput = includePending
      ? rawTxs
      : rawTxs.filter((t) => (t.approval_status ?? "approved") !== "pending_approval");
    const baseTransactions = [
      ...forecastInput,
      ...computeTaxEvents(country as "SE" | "NO" | "GB" | "US"),
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
    );
    const simulatedForecast = computeForecast(
      startBalance,
      threshold,
      simulatedTransactions,
      SIMULATION_DAYS,
      fromDate,
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
