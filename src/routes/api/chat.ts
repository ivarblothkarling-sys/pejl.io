import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  generateText,
  Output,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { getDashboardData } from "@/lib/api/finance.functions";
import { computeForecast, formatSEK, type Tx } from "@/lib/forecast";

type ChatRequestBody = { messages?: unknown };

const DISCLAIMER =
  "Pejl ger dig och din redovisningskonsult en gemensam bild av likviditeten framåt – baserat på bokförd data i Fortnox. Ersätter inte bokföring eller rådgivning. Du och din konsult beslutar alltid själv.";

const CHAT_HISTORY_LIMIT = 10;

/**
 * Verifierar bearer-token mot Supabase och returnerar det verifierade user-id:t
 * (aldrig ett ovaliderat sub-fält) — används som nyckel för rate limiting innan
 * vi gör något dyrt arbete (dashboard-data, LLM-anrop).
 */
async function getVerifiedUserId(authHeader: string): Promise<string | null> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
// Endast in-memory — räcker för en enskild serverprocess. Nollställs vid omstart
// och delas inte mellan ev. flera instanser, men stoppar ändå enskilda users
// från att svämma över LLM-anropen.
const rateLimitBuckets = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (rateLimitBuckets.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitBuckets.set(userId, recent);
    return false;
  }
  recent.push(now);
  rateLimitBuckets.set(userId, recent);
  return true;
}

/** Hämtar de senaste CHAT_HISTORY_LIMIT meddelandena för användaren, kronologiskt sorterade. */
async function fetchRecentChatHistory(authHeader: string): Promise<UIMessage[]> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const headers = {
    apikey: process.env.SUPABASE_PUBLISHABLE_KEY!,
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(
    `${supabaseUrl}/rest/v1/chat_messages?select=id,role,content&order=created_at.desc&limit=${CHAT_HISTORY_LIMIT}`,
    { headers },
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as { id: string; role: string; content: string }[];

  return rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .reverse()
    .map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: r.content }],
    }));
}

async function buildSystemPrompt(): Promise<string> {
  const { profile, transactions, forecast, suggestions, awaitingApprovalSum } =
    await getDashboardData();

  const unpaid = transactions.filter((t) => !t.paid);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueInvoices = transactions
    .filter((t) => !t.paid && t.kind === "income" && t.category !== "tax")
    .map((t) => ({
      ...t,
      daysOverdue: Math.round((today.getTime() - new Date(t.due_date).getTime()) / 86400000),
    }))
    .filter((t) => t.daysOverdue > 30)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const breach = forecast.breachDate
    ? `VARNING: saldot går under gränsen ${formatSEK(forecast.threshold)} den ${forecast.breachDate} (saldo då ca ${formatSEK(forecast.breachAmount ?? 0)}).`
    : `Ingen prognosvarning de närmaste 30 dagarna.`;

  const attestWarning =
    awaitingApprovalSum > 0
      ? `VARNING: ${formatSEK(awaitingApprovalSum)} i leverantörsfakturor väntar på attest och räknas inte med i prognosen om inte användaren aktivt valt att inkludera dem.`
      : null;

  const suggestionsBlock = suggestions.length
    ? `\n== Föreslagna åtgärder för att undvika varningen ==\n${suggestions
        .map((s) => `- ${s.label}: ${s.detail}`)
        .join(
          "\n",
        )}\nOm användaren frågar "vad kan jag göra?" eller liknande, presentera dessa förslag som en punktlista och förklara kort varför var och en hjälper.`
    : "";

  const overdueBlock = overdueInvoices.length
    ? `\n== Kundfakturor mer än 30 dagar försenade ==\n${overdueInvoices
        .map(
          (t) =>
            `- ${t.due_date} | ${formatSEK(Number(t.amount))} | ${t.description} (${t.daysOverdue} dagar försenad)`,
        )
        .join("\n")}`
    : `\n== Kundfakturor mer än 30 dagar försenade ==\nInga.`;

  return `Du är Pejl, en proaktiv och saklig ekonomiassistent för svenska småföretagare OCH deras redovisningskonsulter.
Svara alltid på svenska, kort och kärnfullt – max 2–3 meningar, undvik långa utläggningar och upprepningar. Håll tonen krispig och konkret. Belopp i SEK, datum i ISO-format (YYYY-MM-DD).
Använd ENDAST datan nedan – hitta inte på siffror. Svara kontextuellt utifrån den faktiska datan, inte generiskt. Om frågan inte rör datan, svara kort och hjälpsamt ändå.

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
${attestWarning ? `\n${attestWarning}` : ""}
${suggestionsBlock}
${overdueBlock}

== Obetalda transaktioner kommande period ==
${unpaid
  .slice(0, 40)
  .map(
    (t) =>
      `- ${t.due_date} | ${t.kind === "income" ? "INKOMST" : "UTGIFT "} | ${t.category === "tax" ? "[SKATT] " : ""}${formatSEK(Number(t.amount))} | ${t.description}`,
  )
  .join("\n")}`;
}

const CALCULATE_IF_ACTION_HELPS_DESCRIPTION = `Räknar ut om en åtgärd faktiskt löser eller lindrar likviditetsvarningen, genom att räkna om 30-dagarsprognosen som om åtgärden vidtagits. "action" MÅSTE vara en av dessa strängformat (id:t kommer från get_overdue_invoices/get_upcoming_expenses):
- "defer:<id>:<dagar>" — skjuter upp en specifik transaktions förfallodatum med angivet antal dagar.
- "remind:<id>" — simulerar att en kundfaktura betalas idag istället för sitt ordinarie förfallodatum (t.ex. efter en betalningspåminnelse).
Om formatet inte matchar exakt returneras ett fel — gissa inte på ett annat format.`;

/**
 * Genererar 0–N kontextuella, klickbara chattförslag baserat på användarens
 * FAKTISKA data — ersätter den tidigare hårdkodade regelmotorn i
 * dashboard.tsx. Claude får tre verktyg för att undersöka data och simulera
 * åtgärder innan den svarar; om allt ser stabilt ut kan den (och ska den)
 * returnera en tom lista istället för att fylla på till ett visst antal.
 */
async function buildSmartSuggestions(): Promise<string[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return [];

  const { transactions, forecast } = await getDashboardData();

  const tools = {
    get_overdue_invoices: tool({
      description: "Hämtar kundfakturor (inkomster) som är förfallna men obetalda idag.",
      inputSchema: z.object({}),
      execute: async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return transactions
          .filter((t) => !t.paid && t.kind === "income" && new Date(t.due_date) < today)
          .map((t) => ({
            id: t.id,
            description: t.description,
            amount: Number(t.amount),
            dueDate: t.due_date,
            daysOverdue: Math.round((today.getTime() - new Date(t.due_date).getTime()) / 86400000),
          }))
          .sort((a, b) => b.daysOverdue - a.daysOverdue);
      },
    }),
    get_upcoming_expenses: tool({
      description:
        "Hämtar obetalda utgifter (leverantörsfakturor, skatter m.m.) som förfaller inom angivet antal dagar framåt.",
      inputSchema: z.object({ days: z.number().int().min(1).max(90) }),
      execute: async ({ days }) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() + days);
        return transactions
          .filter((t) => !t.paid && t.kind === "expense")
          .filter((t) => {
            const d = new Date(t.due_date);
            return d >= today && d <= cutoff;
          })
          .map((t) => ({
            id: t.id,
            description: t.description,
            amount: Number(t.amount),
            dueDate: t.due_date,
            isTax: t.category === "tax",
          }))
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      },
    }),
    calculate_if_action_helps: tool({
      description: CALCULATE_IF_ACTION_HELPS_DESCRIPTION,
      inputSchema: z.object({ action: z.string() }),
      execute: async ({ action }) => {
        const deferMatch = action.match(/^defer:([^:]+):(\d+)$/);
        const remindMatch = action.match(/^remind:([^:]+)$/);

        let modified: Tx[];
        if (deferMatch) {
          const [, txId, daysStr] = deferMatch;
          const tx = transactions.find((t) => t.id === txId);
          if (!tx) return { error: `Ingen transaktion med id "${txId}" hittades.` };
          const newDate = new Date(tx.due_date);
          newDate.setDate(newDate.getDate() + Number(daysStr));
          const newDueDate = newDate.toISOString().slice(0, 10);
          modified = transactions.map((t) => (t.id === txId ? { ...t, due_date: newDueDate } : t));
        } else if (remindMatch) {
          const [, txId] = remindMatch;
          const tx = transactions.find((t) => t.id === txId);
          if (!tx) return { error: `Ingen transaktion med id "${txId}" hittades.` };
          const todayIso = new Date().toISOString().slice(0, 10);
          modified = transactions.map((t) => (t.id === txId ? { ...t, due_date: todayIso } : t));
        } else {
          return {
            error: `Okänt action-format: "${action}". Använd "defer:<id>:<dagar>" eller "remind:<id>".`,
          };
        }

        const newForecast = computeForecast(
          forecast.startBalance,
          forecast.threshold,
          [...modified].sort((a, b) => a.due_date.localeCompare(b.due_date)),
          30,
        );
        return {
          helps: forecast.breachDate !== null && newForecast.breachDate === null,
          originalBreachDate: forecast.breachDate,
          originalBreachAmount: forecast.breachAmount,
          newBreachDate: newForecast.breachDate,
          newBreachAmount: newForecast.breachAmount,
          newMinBalance: newForecast.minBalance,
        };
      },
    }),
  };

  const gateway = createLovableAiGatewayProvider(key);
  const result = await generateText({
    model: gateway("google/gemini-3-flash-preview"),
    system: `Du är Pejl, en ekonomiassistent. Din enda uppgift just nu är att generera 0–4 korta, konkreta chattförslag (på svenska, max ~12 ord var) som användaren skulle vilja klicka på, baserat på DERAS FAKTISKA data.

Använd verktygen för att undersöka förfallna kundfakturor och kommande utgifter, och simulera relevanta åtgärder innan du bestämmer dig — gissa aldrig.

Regler:
- Om allt ser stabilt ut (ingen prognosvarning, inga förfallna fakturor) — returnera en TOM lista. Hitta inte på förslag för att fylla en kvot.
- Föreslå ALDRIG exakt tre stycken av gammal vana. Antalet ska spegla vad datan faktiskt visar.
- Varje förslag ska vara skrivet som en fråga/uppmaning från användarens perspektiv, t.ex. "Kan jag skjuta upp hyran en vecka?" — inte ett påstående om läget.`,
    prompt: "Generera kontextuella chattförslag baserat på min nuvarande ekonomi.",
    tools,
    stopWhen: stepCountIs(4),
    output: Output.array({ element: z.string() }),
  });

  return result.output ?? [];
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

        const authHeader = request.headers.get("authorization");
        const gateway = createLovableAiGatewayProvider(key);

        if (!authHeader) {
          const result = streamText({
            model: gateway("google/gemini-3-flash-preview"),
            system: "Du är Pejl, en svensk ekonomiassistent. Användaren är inte inloggad.",
            messages: await convertToModelMessages(messages as UIMessage[]),
          });
          return result.toUIMessageStreamResponse({ originalMessages: messages as UIMessage[] });
        }

        const userId = await getVerifiedUserId(authHeader);
        if (!userId) return new Response("Unauthorized", { status: 401 });
        if (!checkRateLimit(userId)) {
          return new Response("För många meddelanden — vänta en minut och försök igen.", {
            status: 429,
            headers: { "Retry-After": "60" },
          });
        }

        // Serverns egen kontext, inte klientens: hämta senaste historiken från
        // chat_messages och bygg systemprompten från faktisk dashboard-data,
        // istället för att blint lita på hela meddelande-arrayen klienten skickar.
        const [history, system] = await Promise.all([
          fetchRecentChatHistory(authHeader),
          buildSystemPrompt().catch((err) => {
            console.error("[chat] Kunde inte bygga systemprompt från dashboard-data:", err);
            return "Du är Pejl, en svensk ekonomiassistent. Kunde inte läsa aktuell ekonomidata just nu — svara kort och be användaren försöka igen om frågan kräver siffror.";
          }),
        ]);

        const latestClientMessage = (messages as UIMessage[]).at(-1);
        const conversation = latestClientMessage ? [...history, latestClientMessage] : history;

        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system,
          messages: await convertToModelMessages(conversation),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },

      // Datadrivna chattförslag för dashboardens tomma chattläge — se
      // buildSmartSuggestions ovan. Delar auth/rate-limit med POST ovan.
      GET: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        if (!authHeader) return Response.json({ suggestions: [] });

        const userId = await getVerifiedUserId(authHeader);
        if (!userId) return new Response("Unauthorized", { status: 401 });
        if (!checkRateLimit(userId)) {
          return new Response("För många förfrågningar — vänta en minut och försök igen.", {
            status: 429,
            headers: { "Retry-After": "60" },
          });
        }

        try {
          const suggestions = await buildSmartSuggestions();
          return Response.json({ suggestions });
        } catch (err) {
          console.error("[chat] Kunde inte generera smarta förslag:", err);
          return Response.json({ suggestions: [] });
        }
      },
    },
  },
});
