import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAgencyClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAgency = (roles ?? []).some((r) => r.role === "agency");

    if (!isAgency) return { isAgency: false, clients: [] as AgencyClient[] };

    const { data, error } = await supabase
      .from("agency_clients")
      .select(
        "id, name, current_balance, threshold, next_warning_date, next_warning_amount, status, notes",
      )
      .eq("agency_user_id", userId)
      .order("status", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    return { isAgency: true, clients: (data ?? []) as AgencyClient[] };
  });

export type AgencyClient = {
  id: string;
  name: string;
  current_balance: number;
  threshold: number;
  next_warning_date: string | null;
  next_warning_amount: number | null;
  status: "green" | "yellow" | "red";
  notes: string | null;
};

const clientSchema = z.object({
  name: z.string().min(1).max(200),
  current_balance: z.number(),
  threshold: z.number().min(0),
  next_warning_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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
