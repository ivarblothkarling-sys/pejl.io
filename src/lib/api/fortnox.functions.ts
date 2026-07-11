import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FORTNOX_AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";
const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const FORTNOX_SCOPES = [
  "companyinformation",
  "invoice",
  "supplierinvoice",
  "bookkeeping",
  "payment",
  "customer",
].join(" ");

function getRedirectUri(override?: string): string {
  if (override && /^https?:\/\//.test(override)) return override;
  return (
    process.env.FORTNOX_REDIRECT_URI ??
    "http://localhost:8080/auth/fortnox/callback"
  );
}

export const getFortnoxAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { redirectUri?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const clientId = process.env.FORTNOX_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "Fortnox är inte konfigurerad — FORTNOX_CLIENT_ID saknas.",
      );
    }
    const redirectUri = getRedirectUri(data?.redirectUri);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: FORTNOX_SCOPES,
      state: "pejl",
      response_type: "code",
      access_type: "offline",
    });
    return { url: `${FORTNOX_AUTH_URL}?${params.toString()}`, redirectUri };
  });

export const getFortnoxStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("fortnox_connections")
      .select("created_at, scope, expires_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      connected: !!data,
      connectedAt: data?.created_at ?? null,
      expiresAt: data?.expires_at ?? null,
    };
  });

export const exchangeFortnoxCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      code: z.string().min(1),
      state: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const clientId = process.env.FORTNOX_CLIENT_ID;
    const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "Fortnox är inte konfigurerad — kontrollera FORTNOX_CLIENT_ID och FORTNOX_CLIENT_SECRET.",
      );
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: data.code,
      redirect_uri: getRedirectUri(),
    });

    const res = await fetch(FORTNOX_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fortnox token-utbyte misslyckades: ${res.status} ${text}`);
    }

    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
      scope?: string;
    };

    const expiresAt = json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : null;

    const { error: upsertErr } = await context.supabase
      .from("fortnox_connections")
      .upsert(
        {
          user_id: context.userId,
          access_token: json.access_token,
          refresh_token: json.refresh_token,
          expires_at: expiresAt,
          scope: json.scope ?? FORTNOX_SCOPES,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (upsertErr) throw new Error(upsertErr.message);

    return { ok: true };
  });
