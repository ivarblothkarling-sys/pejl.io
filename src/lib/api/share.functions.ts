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
    const [profileRes, txRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabaseAdmin
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
      company_name: "Företaget",
    };
    const transactions = [
      ...((txRes.data ?? []) as Tx[]),
      ...computeTaxEvents(),
    ].sort((a, b) => a.due_date.localeCompare(b.due_date));

    const forecast = computeForecast(
      Number(profile.current_balance) || 0,
      Number(profile.threshold) || 0,
      transactions,
      14,
    );

    return { profile, transactions, forecast };
  });
