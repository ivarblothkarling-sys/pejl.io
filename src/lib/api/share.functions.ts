import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeForecast, type Tx } from "@/lib/forecast";
import { computeTaxEvents } from "@/lib/tax";

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = crypto.randomUUID().replace(/-/g, "");
    // expires_at sätts av kolumnens DEFAULT (now() + 30 dagar) — läs tillbaka
    // det faktiska värdet istället för att räkna ut det själv på klienten.
    const { data: inserted, error } = await context.supabase
      .from("share_tokens")
      .insert({ token, user_id: context.userId })
      .select("expires_at")
      .single();
    if (error) throw new Error(error.message);
    return { token, expiresAt: inserted.expires_at };
  });

export const getActiveShareLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("share_tokens")
      .select("token, created_at, expires_at")
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

export const getSharedDashboard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string().min(8).max(64) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: tokenErr } = await supabaseAdmin
      .from("share_tokens")
      .select("user_id, expires_at")
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

    const country = ((profile as { country?: string }).country ?? "SE") as
      "SE" | "NO" | "GB" | "US";
    const vatPeriod = ((profile as { vat_period?: string }).vat_period ?? "monthly") as
      "monthly" | "quarterly" | "yearly";
    const transactions = [
      ...((txData ?? []) as Tx[]),
      ...computeTaxEvents(country, new Date(), 14, vatPeriod),
    ].sort((a, b) => a.due_date.localeCompare(b.due_date));

    const forecast = computeForecast(
      Number(profile.current_balance) || 0,
      Number(profile.threshold) || 0,
      transactions,
      14,
      new Date(),
      country,
      vatPeriod,
    );

    return { profile, transactions, forecast };
  });
