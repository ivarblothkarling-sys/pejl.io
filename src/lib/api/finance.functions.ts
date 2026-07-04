import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeForecast, computeSuggestions, formatSEK, type Tx } from "@/lib/forecast";
import { computeTaxEvents } from "@/lib/tax";

export const getDashboardData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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

    const profile = profileRes.data ?? { current_balance: 0, threshold: 0, company_name: "Mitt företag", country: "SE", currency: "SEK", language: "sv", accounting_provider: "fortnox" };
    const country = (profile as { country?: string }).country ?? "SE";
    const transactions = [
      ...((txRes.data ?? []) as Tx[]),
      ...computeTaxEvents(country as "SE" | "NO" | "GB" | "US"),
    ].sort((a, b) => a.due_date.localeCompare(b.due_date));

    const forecast = computeForecast(
      Number(profile.current_balance) || 0,
      Number(profile.threshold) || 0,
      transactions,
      30,
    );
    const suggestions = computeSuggestions(forecast, transactions);

    return { profile, transactions, forecast, suggestions };
  });


export const updateThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ threshold: z.number().min(0) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ threshold: data.threshold, updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

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
    const country = (profile as { country?: string }).country ?? "SE";
    const txs = [
      ...((txRes.data ?? []) as Tx[]),
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

Företag: ${profile.company_name}
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
  });
