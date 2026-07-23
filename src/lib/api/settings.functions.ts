import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const providerEnum = z.enum(["fortnox", "sie", "tripletex", "xero", "quickbooks"]);
const waitlistProviderEnum = z.enum(["tripletex", "xero", "quickbooks"]);
const currencyEnum = z.enum(["SEK", "NOK", "GBP", "EUR", "USD"]);
const languageEnum = z.enum(["sv", "en"]);
const countryEnum = z.enum(["SE", "NO", "GB", "US"]);

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("accounting_provider, currency, country, language, include_pending_in_forecast")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const { data: waitlist } = await supabase
      .from("provider_waitlist")
      .select("provider")
      .eq("user_id", userId);

    return {
      accounting_provider: profile?.accounting_provider ?? "fortnox",
      currency: profile?.currency ?? "SEK",
      country: profile?.country ?? "SE",
      language: profile?.language ?? "sv",
      include_pending_in_forecast: profile?.include_pending_in_forecast ?? false,
      waitlist: (waitlist ?? []).map((w) => w.provider as string),
    };
  });

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      accounting_provider: providerEnum.optional(),
      currency: currencyEnum.optional(),
      country: countryEnum.optional(),
      language: languageEnum.optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    if (Object.keys(data).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("profiles")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const joinProviderWaitlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ provider: waitlistProviderEnum }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("provider_waitlist")
      .upsert(
        { user_id: context.userId, provider: data.provider },
        { onConflict: "user_id,provider" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const sieTxSchema = z.object({
  kind: z.enum(["income", "expense"]),
  amount: z.number().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(200),
});

export const importSieData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      companyName: z.string().max(200).optional(),
      currentBalance: z.number(),
      transactions: z.array(sieTxSchema).max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Update profile: provider=sie, balance, company name
    const profileUpdate: {
      accounting_provider: "sie";
      current_balance: number;
      updated_at: string;
      company_name?: string;
    } = {
      accounting_provider: "sie",
      current_balance: data.currentBalance,
      updated_at: new Date().toISOString(),
    };
    if (data.companyName) profileUpdate.company_name = data.companyName;

    const { error: pErr } = await supabase
      .from("profiles")
      .update(profileUpdate)
      .eq("id", userId);
    if (pErr) throw new Error(pErr.message);

    // Dedup mot redan importerade SIE-rader istället för att blint tömma och
    // återinsätta — annars skulle en omkörning av samma fil (eller en fil som
    // delvis överlappar en tidigare import) dubblera transaktioner. Nyckeln
    // är due_date+amount, precis som en identisk rad ser ut i SIE-filen.
    // OBS: rör inte transaktioner från andra källor (fortnox/tink/mock) —
    // den gamla koden gjorde det av misstag genom att radera hela tabellen.
    const { data: existingSie, error: existingErr } = await supabase
      .from("transactions")
      .select("due_date, amount")
      .eq("user_id", userId)
      .eq("source", "sie");
    if (existingErr) throw new Error(existingErr.message);

    const existingKeys = new Set(
      (existingSie ?? []).map((t) => `${t.due_date}|${Number(t.amount)}`),
    );
    const newTransactions = data.transactions.filter(
      (t) => !existingKeys.has(`${t.due_date}|${t.amount}`),
    );

    if (newTransactions.length > 0) {
      const rows = newTransactions.map((t) => ({
        user_id: userId,
        kind: t.kind,
        amount: t.amount,
        due_date: t.due_date,
        description: t.description,
        paid: false,
        source: "sie",
      }));
      const { error: insErr } = await supabase.from("transactions").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    return {
      ok: true,
      count: newTransactions.length,
      skipped: data.transactions.length - newTransactions.length,
    };
  });
