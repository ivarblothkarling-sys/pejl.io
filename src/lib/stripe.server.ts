// Server-only: delad Stripe-klient. Läs process.env INUTI en funktion
// (aldrig vid modul-toppnivå) — Cloudflare Workers binder env vid
// request-tid, se lib/config.server.ts.
import Stripe from "stripe";

export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe är inte konfigurerad — STRIPE_SECRET_KEY saknas.");
  return new Stripe(key);
}

export type BillingPlan = "solo" | "solo_plus";

export const BILLING_PLANS: Record<BillingPlan, { name: string; amountOre: number }> = {
  solo: { name: "Pejl Solo", amountOre: 29900 },
  solo_plus: { name: "Pejl Solo+", amountOre: 49900 },
};

export const TRIAL_PERIOD_DAYS = 30;
