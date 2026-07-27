import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const providerEnum = z.enum(["fortnox", "sie", "tripletex", "xero", "quickbooks"]);
const waitlistProviderEnum = z.enum(["tripletex", "xero", "quickbooks"]);
const currencyEnum = z.enum(["SEK", "NOK", "GBP", "EUR", "USD"]);
const languageEnum = z.enum(["sv", "en"]);
const countryEnum = z.enum(["SE", "NO", "GB", "US"]);
const vatPeriodEnum = z.enum(["monthly", "quarterly", "yearly"]);

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string } | undefined) => input ?? {})
  .handler(async ({ data: input, context }) => {
    const { supabase, userId } = context;
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    // select("*") istället för en namngiven kolumnlista — en namngiven lista
    // failar HÅRT (Postgrest-fel, inte bara ett saknat fält) om en enda
    // kolumn saknas i databasen, vilket gjorde att Inställningar-sidan
    // fastnade permanent på "Laddar…" när vat_period-migrationen ännu inte
    // var synkad till produktions-DB:n. select("*") degraderar snällt precis
    // som getDashboardData m.fl. redan gör.
    const [{ data: profile, error }, company] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      resolveCompany(supabase, userId, input.companyId),
    ]);
    if (error) throw new Error(error.message);

    const { data: waitlist } = await supabase
      .from("provider_waitlist")
      .select("provider")
      .eq("user_id", userId);

    return {
      companyId: company.id,
      accounting_provider: profile?.accounting_provider ?? "fortnox",
      currency: company.currency ?? "SEK",
      country: company.country ?? "SE",
      language: profile?.language ?? "sv",
      include_pending_in_forecast: company.include_pending_in_forecast ?? false,
      billing_status: (profile?.billing_status ?? "trial") as "trial" | "active" | "cancelled",
      vat_period: (company.vat_period ?? "monthly") as "monthly" | "quarterly" | "yearly",
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
      vat_period: vatPeriodEnum.optional(),
      companyId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { accounting_provider, language, currency, country, vat_period, companyId } = data;
    const profileUpdate: Record<string, unknown> = {};
    if (accounting_provider !== undefined) profileUpdate.accounting_provider = accounting_provider;
    if (language !== undefined) profileUpdate.language = language;

    const companyUpdate: Record<string, unknown> = {};
    if (currency !== undefined) companyUpdate.currency = currency;
    if (country !== undefined) companyUpdate.country = country;
    if (vat_period !== undefined) companyUpdate.vat_period = vat_period;

    if (Object.keys(profileUpdate).length === 0 && Object.keys(companyUpdate).length === 0) {
      return { ok: true };
    }

    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await context.supabase
        .from("profiles")
        .update({ ...profileUpdate, updated_at: new Date().toISOString() })
        .eq("id", context.userId);
      if (error) throw new Error(error.message);
    }

    if (Object.keys(companyUpdate).length > 0) {
      const { resolveCompany } = await import("@/lib/api/companies.functions");
      const company = await resolveCompany(context.supabase, context.userId, companyId);
      const { error } = await context.supabase
        .from("user_companies")
        .update({ ...companyUpdate, updated_at: new Date().toISOString() })
        .eq("id", company.id);
      if (error) throw new Error(error.message);
    }
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
      companyId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const company = await resolveCompany(supabase, userId, data.companyId);

    const { error: pErr } = await supabase
      .from("profiles")
      .update({ accounting_provider: "sie", updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (pErr) throw new Error(pErr.message);

    const companyUpdate: { current_balance: number; updated_at: string; company_name?: string } = {
      current_balance: data.currentBalance,
      updated_at: new Date().toISOString(),
    };
    if (data.companyName) companyUpdate.company_name = data.companyName;
    const { error: cErr } = await supabase
      .from("user_companies")
      .update(companyUpdate)
      .eq("id", company.id);
    if (cErr) throw new Error(cErr.message);

    // Dedup mot redan importerade SIE-rader istället för att blint tömma och
    // återinsätta — annars skulle en omkörning av samma fil (eller en fil som
    // delvis överlappar en tidigare import) dubblera transaktioner. Nyckeln
    // är due_date+amount, precis som en identisk rad ser ut i SIE-filen.
    // OBS: rör inte transaktioner från andra källor (fortnox/tink/mock) —
    // den gamla koden gjorde det av misstag genom att radera hela tabellen.
    const { data: existingSie, error: existingErr } = await supabase
      .from("transactions")
      .select("due_date, amount")
      .eq("company_id", company.id)
      .eq("source", "sie");
    if (existingErr) throw new Error(existingErr.message);

    const { dedupeSieImports } = await import("@/lib/accounting/sie");
    const newTransactions = dedupeSieImports(data.transactions, existingSie ?? []);

    if (newTransactions.length > 0) {
      const rows = newTransactions.map((t) => ({
        user_id: userId,
        company_id: company.id,
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

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GDPR-dataportabilitet: exporterar användarens egna transaktioner som CSV. */
export const exportTransactionsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("transactions")
      .select("*")
      .eq("user_id", context.userId)
      .order("due_date", { ascending: true });
    if (error) throw new Error(error.message);

    const headers = [
      "id",
      "due_date",
      "kind",
      "amount",
      "description",
      "paid",
      "source",
      "approval_status",
      "created_at",
    ];
    const rows = (data ?? []).map((t) =>
      [
        t.id,
        t.due_date,
        t.kind,
        t.amount,
        t.description,
        t.paid,
        t.source,
        t.approval_status ?? "",
        t.created_at,
      ]
        .map(csvEscape)
        .join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");

    return {
      csv,
      filename: `pejl-transaktioner-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  });

const ACCOUNT_DATA_TABLES = [
  "transactions",
  "fortnox_connections",
  "tink_connections",
  "chat_messages",
  "share_tokens",
  "user_companies",
] as const;

/**
 * GDPR-radering: tar bort ALL data kopplad till den inloggade användaren,
 * inklusive Supabase Auth-kontot. Irreversibelt.
 *
 * Barntabellerna raderas explicit (RLS-scopat via context.supabase, dvs.
 * kan bara träffa den anropande användarens egna rader) innan profiles och
 * till sist auth-användaren tas bort. Samtliga user_id-kolumner i schemat
 * har dessutom ON DELETE CASCADE mot auth.users, så det sista steget
 * (auth.admin.deleteUser) städar bort även rader i tabeller som inte listas
 * explicit här (t.ex. user_roles, provider_waitlist, agency_clients) — de
 * explicita raderingarna ovan är för tydlighet/auditerbarhet, inte det enda
 * som faktiskt städar undan datan.
 */
export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    for (const table of ACCOUNT_DATA_TABLES) {
      const { error } = await supabase.from(table).delete().eq("user_id", userId);
      if (error) throw new Error(`Kunde inte radera ${table}: ${error.message}`);
    }

    const { error: profileErr } = await supabase.from("profiles").delete().eq("id", userId);
    if (profileErr) throw new Error(`Kunde inte radera profil: ${profileErr.message}`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) throw new Error(`Kunde inte radera användarkontot: ${authErr.message}`);

    return { ok: true };
  });
