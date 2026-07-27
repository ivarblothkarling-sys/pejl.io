import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureUserBootstrap } = await import("@/lib/userBootstrap.server");
    const { primaryCompanyId } = await ensureUserBootstrap({
      supabase: context.supabase,
      userId: context.userId,
      claims: context.claims,
    });

    const [{ data: profile, error: profileErr }, { data: company, error: companyErr }] =
      await Promise.all([
        context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
        context.supabase
          .from("user_companies")
          .select("*")
          .eq("id", primaryCompanyId)
          .maybeSingle(),
      ]);
    if (profileErr) throw new Error(profileErr.message);
    if (companyErr) throw new Error(companyErr.message);
    return {
      completed: Boolean(profile?.onboarding_completed),
      threshold: Number(company?.threshold ?? 0),
      companyName: company?.company_name ?? "",
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ threshold: z.number().min(0), companyName: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const { resolveCompany } = await import("@/lib/api/companies.functions");
    const company = await resolveCompany(context.supabase, context.userId, null);

    const companyUpdate: { threshold: number; updated_at: string; company_name?: string } = {
      threshold: data.threshold,
      updated_at: new Date().toISOString(),
    };
    if (data.companyName && data.companyName.trim()) {
      companyUpdate.company_name = data.companyName.trim();
    }
    const { error: companyErr } = await context.supabase
      .from("user_companies")
      .update(companyUpdate)
      .eq("id", company.id);
    if (companyErr) throw new Error(companyErr.message);

    const { error: profileErr } = await context.supabase
      .from("profiles")
      .upsert(
        { id: context.userId, onboarding_completed: true, updated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
    if (profileErr) throw new Error(profileErr.message);
    return { ok: true };
  });
