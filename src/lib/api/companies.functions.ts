import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type UserCompany = Database["public"]["Tables"]["user_companies"]["Row"];

/**
 * Hämtar bolaget en åtgärd ska köras mot: det efterfrågade companyId om
 * angivet och det tillhör användaren, annars användarens primära bolag.
 * Skapar ett bolag om användaren (mot förmodan, t.ex. ett race mot
 * userBootstrap) helt saknar en user_companies-rad, så anropande kod aldrig
 * behöver hantera "inget bolag hittades" som ett normalfall.
 */
export async function resolveCompany(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  companyId?: string | null,
): Promise<UserCompany> {
  if (companyId) {
    const { data, error } = await supabase
      .from("user_companies")
      .select("*")
      .eq("id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as UserCompany;
  } else {
    const { data, error } = await supabase
      .from("user_companies")
      .select("*")
      .eq("user_id", userId)
      .eq("is_primary", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as UserCompany;
  }

  const { data: fallback, error: fallbackErr } = await supabase
    .from("user_companies")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fallbackErr) throw new Error(fallbackErr.message);
  if (fallback) return fallback as UserCompany;

  const { data: created, error: createErr } = await supabase
    .from("user_companies")
    .insert({ user_id: userId, is_primary: true })
    .select("*")
    .single();
  if (createErr) throw new Error(createErr.message);
  return created as UserCompany;
}

export const getUserCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_companies")
      .select("*")
      .eq("user_id", context.userId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    if (data && data.length > 0) return data as UserCompany[];
    const company = await resolveCompany(context.supabase, context.userId, null);
    return [company];
  });

export const setPrimaryCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ companyId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: target, error: targetErr } = await supabase
      .from("user_companies")
      .select("id")
      .eq("id", data.companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (targetErr) throw new Error(targetErr.message);
    if (!target) throw new Error("Bolaget hittades inte.");

    const { error: clearErr } = await supabase
      .from("user_companies")
      .update({ is_primary: false })
      .eq("user_id", userId)
      .eq("is_primary", true);
    if (clearErr) throw new Error(clearErr.message);

    const { error: setErr } = await supabase
      .from("user_companies")
      .update({ is_primary: true })
      .eq("id", data.companyId)
      .eq("user_id", userId);
    if (setErr) throw new Error(setErr.message);
    return { ok: true };
  });

export const renameCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ companyId: z.string().uuid(), name: z.string().min(1).max(200) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_companies")
      .update({ company_name: data.name, updated_at: new Date().toISOString() })
      .eq("id", data.companyId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deactivateCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ companyId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: co, error: coErr } = await supabase
      .from("user_companies")
      .select("id, is_primary")
      .eq("id", data.companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (coErr) throw new Error(coErr.message);
    if (!co) throw new Error("Bolaget hittades inte.");
    if (co.is_primary) throw new Error("Kan inte inaktivera huvudbolaget.");

    const { error } = await supabase
      .from("user_companies")
      .update({ is_active: false })
      .eq("id", data.companyId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
