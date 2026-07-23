import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NotificationType =
  "forecast_warning" | "sync_failed" | "weekly_summary" | "bank_discrepancy" | "payment_overdue";

/**
 * Skapar en in-app-notis via service-role. Anropas från serverkod som redan
 * kör som en enskild användare (finance.functions.ts) eller för flera
 * användare i en cron (fortnoxDailySync/weeklySummaryDigest) — därför
 * supabaseAdmin, inte context.supabase.
 */
export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Kopplar notisen till en rad i en annan tabell (t.ex. en transaktion) — används för dedup. */
  relatedId?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    related_id: input.relatedId ?? null,
  });
  if (error) throw new Error(error.message);
}

export const getNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data, error }, { count, error: countErr }] = await Promise.all([
      supabase
        .from("notifications")
        .select("id, type, title, body, read_at, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null),
    ]);
    if (error) throw new Error(error.message);
    if (countErr) throw new Error(countErr.message);
    return { notifications: data ?? [], unreadCount: count ?? 0 };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
