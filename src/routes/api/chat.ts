import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { computeForecast, computeSuggestions, formatSEK, type Tx } from "@/lib/forecast";

type ChatRequestBody = { messages?: unknown };

async function buildSystemPrompt(authHeader: string | null): Promise<string> {
  if (!authHeader) return "Du är Pejl, en svensk ekonomiassistent. Användaren är inte inloggad.";
  const supabaseUrl = process.env.SUPABASE_URL!;
  const token = authHeader.replace(/^Bearer\s+/i, "");

  // Use the user's bearer token against the REST API so RLS scopes everything
  const headers = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${token}` };
  const [profileR, txR] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/profiles?select=*`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/transactions?select=*&order=due_date.asc`, { headers }),
  ]);
  const profileArr = profileR.ok ? await profileR.json() : [];
  const txs = (txR.ok ? await txR.json() : []) as Tx[];
  const profile = profileArr[0] ?? { current_balance: 0, threshold: 0, company_name: "Mitt företag" };

  const forecast = computeForecast(
    Number(profile.current_balance) || 0,
    Number(profile.threshold) || 0,
    txs,
    14,
  );

  const unpaid = txs.filter((t) => !t.paid);
  const breach = forecast.breachDate
    ? `VARNING: saldot går under gränsen ${formatSEK(forecast.threshold)} den ${forecast.breachDate} (saldo då ca ${formatSEK(forecast.breachAmount ?? 0)}).`
    : `Ingen prognosvarning de närmaste 14 dagarna.`;

  const suggestions = computeSuggestions(forecast, txs);
  const suggestionsBlock = suggestions.length
    ? `\n== Föreslagna åtgärder för att undvika varningen ==\n${suggestions
        .map((s) => `- ${s.label}: ${s.detail}`)
        .join("\n")}\nOm användaren frågar "vad kan jag göra?" eller liknande, presentera dessa förslag som en punktlista och förklara kort varför var och en hjälper.`
    : "";

  return `Du är Pejl, en vänlig och rakt-på-sak ekonomiassistent för svenska småföretagare.
Du svarar alltid på svenska, kort och konkret, med belopp i SEK och datum i ISO-format (YYYY-MM-DD) när du refererar dem.
Använd ENDAST datan nedan när du svarar om användarens ekonomi. Hitta inte på siffror.
Om frågan inte rör datan, svara kort och hjälpsamt ändå.

== Företag ==
${profile.company_name}

== Dagens saldo ==
${formatSEK(forecast.startBalance)}

== Prognos 14 dagar ==
Slutsaldo: ${formatSEK(forecast.endBalance)}
Lägsta saldo: ${formatSEK(forecast.minBalance)} (${forecast.minDate})
Vald varningsgräns: ${formatSEK(forecast.threshold)}
${breach}
${suggestionsBlock}

== Obetalda transaktioner kommande period ==
${unpaid
  .slice(0, 40)
  .map((t) => `- ${t.due_date} | ${t.kind === "income" ? "INKOMST" : "UTGIFT "} | ${formatSEK(Number(t.amount))} | ${t.description}`)
  .join("\n")}`;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const system = await buildSystemPrompt(request.headers.get("authorization"));

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system,
          messages: await convertToModelMessages(messages as UIMessage[]),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});
