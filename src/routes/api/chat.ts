import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { computeForecast, computeSuggestions, formatSEK, type Tx } from "@/lib/forecast";
import { computeTaxEvents } from "@/lib/tax";

type ChatRequestBody = { messages?: unknown };

const DISCLAIMER =
  "Pejl ger dig och din redovisningskonsult en gemensam bild av likviditeten framåt – baserat på bokförd data i Fortnox. Ersätter inte bokföring eller rådgivning. Du och din konsult beslutar alltid själv.";

async function buildSystemPrompt(authHeader: string | null): Promise<string> {
  if (!authHeader) return "Du är Pejl, en svensk ekonomiassistent. Användaren är inte inloggad.";
  const supabaseUrl = process.env.SUPABASE_URL!;
  const token = authHeader.replace(/^Bearer\s+/i, "");

  const headers = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${token}` };
  const [profileR, txR] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/profiles?select=*`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/transactions?select=*&order=due_date.asc`, { headers }),
  ]);
  const profileArr = profileR.ok ? await profileR.json() : [];
  const realTxs = (txR.ok ? await txR.json() : []) as Tx[];
  const profile = profileArr[0] ?? { current_balance: 0, threshold: 0, company_name: "Mitt företag", country: "SE" };
  const country = (profile.country ?? "SE") as "SE" | "NO" | "GB" | "US";
  const taxTxs = computeTaxEvents(country);
  const txs = [...realTxs, ...taxTxs].sort((a, b) => a.due_date.localeCompare(b.due_date));

  const forecast = computeForecast(
    Number(profile.current_balance) || 0,
    Number(profile.threshold) || 0,
    txs,
    14,
  );

  const unpaid = txs.filter((t) => !t.paid);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdueInvoices = realTxs
    .filter((t) => !t.paid && t.kind === "income")
    .map((t) => ({ ...t, daysOverdue: Math.round((today.getTime() - new Date(t.due_date).getTime()) / 86400000) }))
    .filter((t) => t.daysOverdue > 30)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const breach = forecast.breachDate
    ? `VARNING: saldot går under gränsen ${formatSEK(forecast.threshold)} den ${forecast.breachDate} (saldo då ca ${formatSEK(forecast.breachAmount ?? 0)}).`
    : `Ingen prognosvarning de närmaste 30 dagarna.`;

  const suggestions = computeSuggestions(forecast, txs);
  const suggestionsBlock = suggestions.length
    ? `\n== Föreslagna åtgärder för att undvika varningen ==\n${suggestions
        .map((s) => `- ${s.label}: ${s.detail}`)
        .join("\n")}\nOm användaren frågar "vad kan jag göra?" eller liknande, presentera dessa förslag som en punktlista och förklara kort varför var och en hjälper.`
    : "";

  const taxBlock = taxTxs.length
    ? `\n== Kommande skatter & avgifter (mock) ==\n${taxTxs
        .map((t) => `- ${t.due_date} | ${formatSEK(t.amount)} | ${t.description}`)
        .join("\n")}`
    : "";

  const overdueBlock = overdueInvoices.length
    ? `\n== Kundfakturor mer än 30 dagar försenade ==\n${overdueInvoices
        .map((t) => `- ${t.due_date} | ${formatSEK(Number(t.amount))} | ${t.description} (${t.daysOverdue} dagar försenad)`)
        .join("\n")}`
    : `\n== Kundfakturor mer än 30 dagar försenade ==\nInga.`;

  return `Du är Pejl, en proaktiv och saklig ekonomiassistent för svenska småföretagare OCH deras redovisningskonsulter.
Svara alltid på svenska, kort och kärnfullt – max 2–3 meningar, undvik långa utläggningar och upprepningar. Håll tonen krispig och konkret. Belopp i SEK, datum i ISO-format (YYYY-MM-DD).
Använd ENDAST datan nedan – hitta inte på siffror. Om frågan inte rör datan, svara kort och hjälpsamt ändå.

VIKTIGT — minne i samtalet:
- Använd hela konversationshistoriken som kontext. Om användaren tidigare nämnt en specifik kund, faktura, leverantör, belopp eller datum – kom ihåg det och referera tillbaka till det ("som du nämnde om Acme AB…") i följande svar utan att fråga igen.
- Om användaren precis bekräftat en åtgärd (t.ex. skickat påminnelse, skjutit fram betalning) – notera det och bekräfta effekten på prognosen kort och aktivt.
- Undvik att upprepa dig eller ställa samma fråga två gånger.

Du svarar lika gärna på en företagares vardagsfrågor ("hur går det?", "vilka fakturor är obetalda?")
som på konsultfrågor, t.ex.:
- "När förfaller momsen nästa gång?" → använd skatter & avgifter-listan
- "Finns det risk att klienten inte kan betala arbetsgivaravgiften den 12:e?" → jämför prognosens saldo det datumet med beloppet
- "Vilka kundfakturor är mer än 30 dagar försenade?" → använd överliggande-listan

Avsluta ALLTID råd, åtgärdsförslag eller riskbedömningar med denna disclaimer på en egen rad i kursiv stil:
_${DISCLAIMER}_

== Företag ==
${profile.company_name}

== Dagens saldo ==
${formatSEK(forecast.startBalance)}

== Prognos 30 dagar ==
Slutsaldo: ${formatSEK(forecast.endBalance)}
Lägsta saldo: ${formatSEK(forecast.minBalance)} (${forecast.minDate})
Vald varningsgräns: ${formatSEK(forecast.threshold)}
${breach}
${suggestionsBlock}
${taxBlock}
${overdueBlock}

== Obetalda transaktioner kommande period ==
${unpaid
  .slice(0, 40)
  .map((t) => `- ${t.due_date} | ${t.kind === "income" ? "INKOMST" : "UTGIFT "} | ${t.category === "tax" ? "[SKATT] " : ""}${formatSEK(Number(t.amount))} | ${t.description}`)
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
