import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TINK_SCOPES = "accounts:read,balances:read,transactions:read,user:read";
const TINK_REDIRECT_URI = "https://pejl.io/auth/tink/callback";

async function syncTinkForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn, error } = await supabaseAdmin
    .from("tink_connections")
    .select("user_id, access_token, refresh_token, expires_at, scope")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conn) throw new Error("Ingen Tink-koppling hittad.");

  const { ensureFreshTinkToken, fetchTinkBalance } = await import("@/lib/tinkApi.server");
  const accessToken = await ensureFreshTinkToken(conn);
  const { balance, currency } = await fetchTinkBalance(accessToken);

  await supabaseAdmin
    .from("tink_connections")
    .update({
      bank_balance: balance,
      bank_currency: currency,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  // Matcha bokförda banktransaktioner mot öppna kundfakturor (±100 kr, ±3
  // dagar) och markera dem betalda. Inkapslat separat från saldo-synken ovan
  // så att ett fel här (t.ex. fel API-shape) inte förstör den redan
  // fungerande saldo-uppdateringen.
  let matchedCount = 0;
  try {
    const { fetchTinkTransactions } = await import("@/lib/tinkApi.server");
    const bankTxs = await fetchTinkTransactions(accessToken);
    const { data: openInvoices, error: openErr } = await supabaseAdmin
      .from("transactions")
      .select("id, amount, due_date")
      .eq("user_id", userId)
      .eq("kind", "income")
      .eq("paid", false);
    if (openErr) throw new Error(openErr.message);

    const MATCH_AMOUNT_TOLERANCE = 100;
    const MATCH_DAY_TOLERANCE = 3;
    const DAY_MS = 86_400_000;
    const usedInvoiceIds = new Set<string>();

    for (const bankTx of bankTxs) {
      if (bankTx.amount <= 0) continue; // bara inbetalningar kan matcha kundfakturor
      const bookingMs = new Date(bankTx.bookingDate).getTime();

      const candidates = (openInvoices ?? [])
        .filter((inv) => !usedInvoiceIds.has(inv.id))
        .map((inv) => ({
          inv,
          amountDiff: Math.abs(Number(inv.amount) - bankTx.amount),
          dayDiff: Math.abs((new Date(inv.due_date).getTime() - bookingMs) / DAY_MS),
        }))
        .filter((c) => c.amountDiff <= MATCH_AMOUNT_TOLERANCE && c.dayDiff <= MATCH_DAY_TOLERANCE)
        .sort((a, b) => a.amountDiff - b.amountDiff || a.dayDiff - b.dayDiff);

      const match = candidates[0]?.inv;
      if (match) {
        usedInvoiceIds.add(match.id);
        const { error: updErr } = await supabaseAdmin
          .from("transactions")
          .update({ paid: true, paid_at: bankTx.bookingDate, approval_status: "paid" })
          .eq("id", match.id);
        if (updErr) throw new Error(updErr.message);
        matchedCount++;
      }
    }
  } catch (err) {
    console.error("[Tink] Transaktionsmatchning misslyckades:", err);
  }

  return { balance, currency, matchedCount };
}

export const getTinkAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { redirectUri?: string } | undefined) => input ?? {})
  .handler(async ({ context }) => {
    const clientId = process.env.TINK_CLIENT_ID;
    const clientSecret = process.env.TINK_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new Error("Tink är inte konfigurerad — kontrollera TINK_CLIENT_ID och TINK_CLIENT_SECRET.");

    const { createTinkState } = await import("@/lib/tinkState.server");
    const state = createTinkState(context.userId, clientSecret);
    const redirectUri = TINK_REDIRECT_URI;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      market: "SE",
      locale: "sv_SE",
      scope: TINK_SCOPES,
      state,
      test: "true", // Tink sandbox
    });
    const url = `https://link.tink.com/1.0/transactions/connect-accounts?${params.toString()}`;
    return { url, redirectUri };
  });

export const getTinkStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tink_connections")
      .select("created_at, bank_balance, bank_currency, last_synced_at, expires_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      connected: !!data,
      connectedAt: data?.created_at ?? null,
      bankBalance: data?.bank_balance != null ? Number(data.bank_balance) : null,
      bankCurrency: data?.bank_currency ?? null,
      lastSyncedAt: data?.last_synced_at ?? null,
    };
  });

export const exchangeTinkCode = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      code: z.string().min(1),
      state: z.string().min(1),
      redirectUri: z.string().url().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const clientId = process.env.TINK_CLIENT_ID;
    const clientSecret = process.env.TINK_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new Error("Tink är inte konfigurerad — saknar CLIENT_ID/SECRET.");

    const { verifyTinkState } = await import("@/lib/tinkState.server");
    const statePayload = verifyTinkState(data.state, clientSecret);

    const { exchangeTinkAuthCode } = await import("@/lib/tinkApi.server");
    const tokens = await exchangeTinkAuthCode(
      data.code,
      clientId,
      clientSecret,
      TINK_REDIRECT_URI,
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tink_connections").upsert(
      {
        user_id: statePayload.userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope ?? TINK_SCOPES,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    try {
      await syncTinkForUser(statePayload.userId);
    } catch (err) {
      console.error("[Tink] Initial synk misslyckades:", err);
    }
    return { ok: true };
  });

export const syncTink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return syncTinkForUser(context.userId);
  });

export const disconnectTink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("tink_connections")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
