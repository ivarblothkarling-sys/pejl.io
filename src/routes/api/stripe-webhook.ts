import { createFileRoute } from "@tanstack/react-router";

import { getStripeClient } from "@/lib/stripe.server";

export const Route = createFileRoute("/api/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("stripe-signature");
        if (!signature) return new Response("Missing stripe-signature header", { status: 400 });

        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) return new Response("Missing STRIPE_WEBHOOK_SECRET", { status: 500 });

        // Rå body krävs för signaturverifiering — request.json() skulle
        // omformatera bytes:en och göra HMAC-kontrollen ogiltig.
        const payload = await request.text();

        const stripe = getStripeClient();
        let event;
        try {
          // constructEventAsync (inte constructEvent) — Cloudflare Workers
          // saknar Node-crypto, verifieringen måste gå via SubtleCrypto.
          event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
        } catch (err) {
          console.error("[stripe-webhook] Ogiltig signatur:", err);
          return new Response("Invalid signature", { status: 400 });
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const userId = session.client_reference_id;
          if (!userId) {
            console.error("[stripe-webhook] checkout.session.completed utan client_reference_id");
            return new Response("Missing client_reference_id", { status: 400 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : (session.subscription?.id ?? null);

          const { error } = await supabaseAdmin
            .from("profiles")
            .update({
              billing_status: "active",
              stripe_subscription_id: subscriptionId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);
          if (error) {
            console.error("[stripe-webhook] Kunde inte uppdatera billing_status:", error.message);
            return new Response("Database update failed", { status: 500 });
          }

          console.log(`[stripe-webhook] billing_status='active' satt för ${userId}`);
        }

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
