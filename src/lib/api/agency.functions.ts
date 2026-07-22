import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeForecast, type Tx } from "@/lib/forecast";

export type AgencyClient = {
  id: string;
  name: string;
  current_balance: number;
  threshold: number;
  next_warning_date: string | null;
  next_warning_amount: number | null;
  status: "green" | "yellow" | "red";
  notes: string | null;
  client_user_id: string | null;
};

const RED_WITHIN_DAYS = 7;

function deriveStatus(breachDate: string | null): "green" | "yellow" | "red" {
  if (!breachDate) return "green";
  const daysUntilBreach = Math.round((new Date(breachDate).getTime() - Date.now()) / 86400000);
  return daysUntilBreach <= RED_WITHIN_DAYS ? "red" : "yellow";
}

export const getAgencyClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("agency_clients")
      .select(
        "id, name, current_balance, threshold, next_warning_date, next_warning_amount, status, notes, client_user_id",
      )
      .eq("agency_user_id", userId)
      .order("status", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const linkedIds = rows.map((r) => r.client_user_id).filter((id): id is string => !!id);

    const liveByUserId = new Map<
      string,
      {
        current_balance: number;
        threshold: number;
        breachDate: string | null;
        breachAmount: number | null;
      }
    >();

    if (linkedIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [profilesRes, txRes] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id, current_balance, threshold, include_pending_in_forecast")
          .in("id", linkedIds),
        supabaseAdmin
          .from("transactions")
          .select("id, user_id, kind, amount, due_date, description, paid, approval_status")
          .in("user_id", linkedIds),
      ]);
      if (profilesRes.error) throw new Error(profilesRes.error.message);
      if (txRes.error) throw new Error(txRes.error.message);

      const txByUser = new Map<string, Tx[]>();
      for (const t of txRes.data ?? []) {
        const list = txByUser.get(t.user_id) ?? [];
        list.push({
          id: t.id,
          kind: t.kind as Tx["kind"],
          amount: Number(t.amount),
          due_date: t.due_date,
          description: t.description,
          paid: t.paid,
          approval_status: t.approval_status as Tx["approval_status"],
        });
        txByUser.set(t.user_id, list);
      }

      for (const p of profilesRes.data ?? []) {
        const includePending = Boolean(p.include_pending_in_forecast);
        const txs = (txByUser.get(p.id) ?? [])
          .filter((t) => includePending || (t.approval_status ?? "approved") !== "pending_approval")
          .sort((a, b) => a.due_date.localeCompare(b.due_date));
        const forecast = computeForecast(
          Number(p.current_balance) || 0,
          Number(p.threshold) || 0,
          txs,
          30,
        );
        liveByUserId.set(p.id, {
          current_balance: Number(p.current_balance) || 0,
          threshold: Number(p.threshold) || 0,
          breachDate: forecast.breachDate,
          breachAmount: forecast.breachAmount,
        });
      }
    }

    const clients: AgencyClient[] = rows.map((r) => {
      const live = r.client_user_id ? liveByUserId.get(r.client_user_id) : undefined;
      // Inte kopplad till en riktig användare (eller data saknas) — visa de manuellt satta fälten.
      if (!live) return r as AgencyClient;
      return {
        id: r.id,
        name: r.name,
        notes: r.notes,
        client_user_id: r.client_user_id,
        current_balance: live.current_balance,
        threshold: live.threshold,
        next_warning_date: live.breachDate,
        next_warning_amount: live.breachAmount,
        status: deriveStatus(live.breachDate),
      };
    });

    return { isAgency: true, clients };
  });

const clientSchema = z.object({
  name: z.string().min(1).max(200),
  current_balance: z.number(),
  threshold: z.number().min(0),
  next_warning_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  next_warning_amount: z.number().nullable().optional(),
  status: z.enum(["green", "yellow", "red"]),
  notes: z.string().max(500).nullable().optional(),
});

export const upsertAgencyClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid().optional(),
      client: clientSchema,
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row = { ...data.client, agency_user_id: userId };
    if (data.id) {
      const { error } = await supabase
        .from("agency_clients")
        .update(row)
        .eq("id", data.id)
        .eq("agency_user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: inserted, error } = await supabase
      .from("agency_clients")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });

export const deleteAgencyClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("agency_clients")
      .delete()
      .eq("id", data.id)
      .eq("agency_user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const inviteAgencyClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      agencyClientId: z.string().uuid(),
      email: z.string().email(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: client, error: clientErr } = await supabase
      .from("agency_clients")
      .select("id, name, client_user_id")
      .eq("id", data.agencyClientId)
      .eq("agency_user_id", userId)
      .maybeSingle();
    if (clientErr) throw new Error(clientErr.message);
    if (!client) throw new Error("Klienten hittades inte.");
    if (client.client_user_id) throw new Error("Den här klienten är redan kopplad till ett konto.");

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name")
      .eq("id", userId)
      .maybeSingle();

    const token = crypto.randomUUID().replace(/-/g, "");
    const { error: insertErr } = await supabase.from("agency_invites").insert({
      agency_user_id: userId,
      agency_client_id: client.id,
      email: data.email,
      token,
    });
    if (insertErr) throw new Error(insertErr.message);

    const { sendAgencyInviteEmail } = await import("@/lib/agencyInviteEmail.server");
    const result = await sendAgencyInviteEmail({
      to: data.email,
      agencyName: profile?.company_name ?? "Din redovisningsbyrå",
      clientName: client.name,
      acceptUrl: `https://pejl.io/accept-invite?token=${token}`,
    });

    return { ok: true, emailSent: result.ok };
  });

export const acceptAgencyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ token: z.string().min(8).max(64) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from("agency_invites")
      .select("id, agency_client_id, accepted_at")
      .eq("token", data.token)
      .maybeSingle();
    if (inviteErr) throw new Error(inviteErr.message);
    if (!invite) throw new Error("Inbjudan hittades inte.");
    if (invite.accepted_at) throw new Error("Inbjudan har redan accepterats.");

    const { data: client, error: clientErr } = await supabaseAdmin
      .from("agency_clients")
      .select("id, name, client_user_id")
      .eq("id", invite.agency_client_id)
      .maybeSingle();
    if (clientErr) throw new Error(clientErr.message);
    if (!client) throw new Error("Klienten hittades inte längre.");
    if (client.client_user_id) throw new Error("Den här klienten är redan kopplad till ett konto.");

    const { error: linkErr } = await supabaseAdmin
      .from("agency_clients")
      .update({ client_user_id: context.userId, updated_at: new Date().toISOString() })
      .eq("id", invite.agency_client_id);
    if (linkErr) throw new Error(linkErr.message);

    const { error: acceptErr } = await supabaseAdmin
      .from("agency_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    if (acceptErr) throw new Error(acceptErr.message);

    return { ok: true, clientName: client.name as string };
  });
