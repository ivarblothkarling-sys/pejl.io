import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BILLING_PLANS, TRIAL_PERIOD_DAYS, getStripeClient } from "@/lib/stripe.server";

const CHECKOUT_RETURN_URL = "https://pejl.io/dashboard";

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ plan: z.enum(["solo", "solo_plus"]) }))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const plan = BILLING_PLANS[data.plan];

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("stripe_customer_id, company_name")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);

    const stripe = getStripeClient();

    // Återanvänd Stripe-kunden om användaren redan checkat ut tidigare
    // (t.ex. avbröt eller vill byta plan) — undviker dubbletter av kunder.
    let customerId = profile?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const email = claims?.email as string | undefined;
      const customer = await stripe.customers.create({
        email,
        name: profile?.company_name ?? undefined,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (updateErr) throw new Error(updateErr.message);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "sek",
            unit_amount: plan.amountOre,
            recurring: { interval: "month" },
            product_data: { name: plan.name },
          },
        },
      ],
      subscription_data: {
        trial_period_days: TRIAL_PERIOD_DAYS,
        metadata: { supabase_user_id: userId, plan: data.plan },
      },
      metadata: { supabase_user_id: userId, plan: data.plan },
      success_url: CHECKOUT_RETURN_URL,
      cancel_url: CHECKOUT_RETURN_URL,
    });

    if (!session.url) throw new Error("Stripe returnerade ingen checkout-URL.");
    return { url: session.url };
  });
