import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TINK_SCOPES = "accounts:read,balances:read,transactions:read,user:read";

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

  return { balance, currency };
}

export const getTinkAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { redirectUri?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const clientId = process.env.TINK_CLIENT_ID;
    const clientSecret = process.env.TINK_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new Error("Tink är inte konfigurerad — kontrollera TINK_CLIENT_ID och TINK_CLIENT_SECRET.");

    const { createTinkState } = await import("@/lib/tinkState.server");
    const state = createTinkState(context.userId, clientSecret);
    const redirectUri =
      data?.redirectUri && /^https?:\/\//.test(data.redirectUri)
        ? data.redirectUri
        : (process.env.TINK_REDIRECT_URI ?? "https://pejl.io/auth/tink/callback");

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
    const tokens = await exchangeTinkAuthCode(data.code, clientId, clientSecret);

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
