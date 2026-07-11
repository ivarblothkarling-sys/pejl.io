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
    // Läs server-side env (aldrig import.meta.env för secrets).
    const clientId = process.env.FORTNOX_CLIENT_ID;
    console.log(
      "[Fortnox] getFortnoxAuthUrl — FORTNOX_CLIENT_ID present:",
      !!clientId,
      "length:",
      clientId?.length ?? 0,
      "prefix:",
      clientId ? clientId.slice(0, 4) : "(none)",
    );
    if (!clientId) {
      console.error(
        "[Fortnox] FORTNOX_CLIENT_ID saknas i process.env. Kontrollera att secreten är satt i Lovable Cloud.",
      );
      throw new Error(
        "Fortnox är inte konfigurerad — FORTNOX_CLIENT_ID saknas i miljövariablerna.",
      );
    }
    const redirectUri = getRedirectUri(data?.redirectUri);
    console.log("[Fortnox] Bygger OAuth-URL med redirectUri:", redirectUri);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: FORTNOX_SCOPES,
      state: "pejl",
      response_type: "code",
      access_type: "offline",
    });
    const url = `${FORTNOX_AUTH_URL}?${params.toString()}`;
    console.log("[Fortnox] OAuth-URL genererad:", url);
    return { url, redirectUri };
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
      redirectUri: z.string().url().optional(),
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
      redirect_uri: getRedirectUri(data.redirectUri),
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
