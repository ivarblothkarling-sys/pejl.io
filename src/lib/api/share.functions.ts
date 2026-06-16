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
    const { error } = await context.supabase
      .from("share_tokens")
      .insert({ token, user_id: context.userId });
    if (error) throw new Error(error.message);
    return { token };
  });

export const getSharedDashboard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string().min(8).max(64) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: tokenErr } = await supabaseAdmin
      .from("share_tokens")
      .select("user_id")
      .eq("token", data.token)
      .maybeSingle();
    if (tokenErr) throw new Error(tokenErr.message);
    if (!row) throw notFound();

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
