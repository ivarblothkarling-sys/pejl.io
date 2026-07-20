// Backoffice/admin server functions. Alla verifierar admin-roll före supabaseAdmin.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
}) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export type AdminStats = {
  userCount: number;
  fortnoxConnected: number;
  tinkConnected: number;
  transactionCount: number;
  recentSignups: Array<{ id: string; email: string; company_name: string | null; created_at: string }>;
};

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminStats> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [users, fortnox, tink, tx, recent] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("fortnox_connections").select("user_id", { count: "exact", head: true }),
      supabaseAdmin.from("tink_connections").select("user_id", { count: "exact", head: true }),
      supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("profiles")
        .select("id, company_name, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const recentIds = (recent.data ?? []).map((r) => r.id);
    const emailMap = new Map<string, string>();
    if (recentIds.length) {
      // auth.admin.listUsers returnerar alla — filtrera i minnet.
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      for (const u of usersData?.users ?? []) {
        if (u.email && recentIds.includes(u.id)) emailMap.set(u.id, u.email);
      }
    }

    return {
      userCount: users.count ?? 0,
      fortnoxConnected: fortnox.count ?? 0,
      tinkConnected: tink.count ?? 0,
      transactionCount: tx.count ?? 0,
      recentSignups: (recent.data ?? []).map((r) => ({
        id: r.id,
        email: emailMap.get(r.id) ?? "(okänd)",
        company_name: r.company_name,
        created_at: r.created_at,
      })),
    };
  });

export type AdminUserRow = {
  id: string;
  email: string;
  company_name: string | null;
  current_balance: number;
  threshold: number;
  roles: string[];
  fortnox: boolean;
  tink: boolean;
  created_at: string;
  transaction_count: number;
};

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profiles }, { data: usersData }, { data: fortnox }, { data: tink }, { data: roles }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id, company_name, current_balance, threshold, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        supabaseAdmin.auth.admin.listUsers({ perPage: 500 }),
        supabaseAdmin.from("fortnox_connections").select("user_id"),
        supabaseAdmin.from("tink_connections").select("user_id"),
        supabaseAdmin.from("user_roles").select("user_id, role"),
      ]);

    const emails = new Map<string, string>();
    for (const u of usersData?.users ?? []) if (u.email) emails.set(u.id, u.email);
    const fortnoxSet = new Set((fortnox ?? []).map((r) => r.user_id));
    const tinkSet = new Set((tink ?? []).map((r) => r.user_id));
    const roleMap = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const list = roleMap.get(r.user_id) ?? [];
      list.push(r.role);
      roleMap.set(r.user_id, list);
    }

    // Räkna transaktioner per user (billig approx: en query)
    const { data: txCounts } = await supabaseAdmin.rpc("noop_ignore_missing").select?.() ?? { data: null };
    // Fallback: räkna via grupperad select
    const { data: txRows } = await supabaseAdmin
      .from("transactions")
      .select("user_id");
    const txMap = new Map<string, number>();
    for (const row of txRows ?? []) txMap.set(row.user_id, (txMap.get(row.user_id) ?? 0) + 1);

    return (profiles ?? []).map((p) => ({
      id: p.id,
      email: emails.get(p.id) ?? "(okänd)",
      company_name: p.company_name,
      current_balance: Number(p.current_balance ?? 0),
      threshold: Number(p.threshold ?? 0),
      roles: roleMap.get(p.id) ?? [],
      fortnox: fortnoxSet.has(p.id),
      tink: tinkSet.has(p.id),
      created_at: p.created_at,
      transaction_count: txMap.get(p.id) ?? 0,
    }));
  });

export const toggleAdminUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      targetUserId: z.string().uuid(),
      role: z.enum(["admin", "agency"]),
    }),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", data.targetUserId)
      .eq("role", data.role)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin.from("user_roles").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true, granted: false };
    }
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.targetUserId, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true, granted: true };
  });

export const deleteAdminUserData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ targetUserId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("transactions")
      .delete()
      .eq("user_id", data.targetUserId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
