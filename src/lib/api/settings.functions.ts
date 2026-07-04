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
      .select("accounting_provider, currency, country, language")
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
  .inputValidator(z.object({ provider: providerEnum }))
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
