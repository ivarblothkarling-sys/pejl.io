import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("onboarding_completed, threshold, company_name")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      completed: Boolean(data?.onboarding_completed),
      threshold: Number(data?.threshold ?? 0),
      companyName: data?.company_name ?? "",
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ threshold: z.number().min(0), companyName: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const update: {
      onboarding_completed: boolean;
      threshold: number;
      updated_at: string;
      company_name?: string;
    } = {
      onboarding_completed: true,
      threshold: data.threshold,
      updated_at: new Date().toISOString(),
    };
    if (data.companyName && data.companyName.trim()) update.company_name = data.companyName.trim();
    const { error } = await context.supabase
      .from("profiles")
      .update(update)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
