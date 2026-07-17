// Tink API-hjälpare — token-refresh och hämtning av kontosaldon.
// Endast server-only kod får importera detta.

const TINK_API_BASE = "https://api.tink.com";

export interface TinkConnectionRow {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
}

export interface TinkTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
}

async function tinkTokenRequest(
  body: URLSearchParams,
  clientId: string,
  clientSecret: string,
): Promise<TinkTokens> {
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  const res = await fetch(`${TINK_API_BASE}/api/v1/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tink token-anrop misslyckades: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    expires_at: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : null,
    scope: json.scope ?? null,
  };
}

export async function exchangeTinkAuthCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<TinkTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
  });
  return tinkTokenRequest(body, clientId, clientSecret);
}

export async function refreshTinkTokens(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<TinkTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return tinkTokenRequest(body, clientId, clientSecret);
}

export async function ensureFreshTinkToken(
  conn: TinkConnectionRow,
): Promise<string> {
  const clientId = process.env.TINK_CLIENT_ID;
  const clientSecret = process.env.TINK_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new Error("Tink är inte konfigurerad — saknar CLIENT_ID/SECRET.");

  const expMs = conn.expires_at ? Date.parse(conn.expires_at) : 0;
  const valid = expMs && expMs - Date.now() > 60_000;
  if (valid) return conn.access_token;
  if (!conn.refresh_token) return conn.access_token;

  const fresh = await refreshTinkTokens(conn.refresh_token, clientId, clientSecret);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("tink_connections")
    .update({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token ?? conn.refresh_token,
      expires_at: fresh.expires_at,
      scope: fresh.scope ?? conn.scope,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", conn.user_id);
  return fresh.access_token;
}

interface TinkAccountsResponse {
  accounts?: Array<{
    id?: string;
    name?: string;
    type?: string;
    balances?: {
      booked?: { amount?: { value?: { unscaledValue?: string; scale?: string }; currencyCode?: string } };
      available?: { amount?: { value?: { unscaledValue?: string; scale?: string }; currencyCode?: string } };
    };
  }>;
}

function parseAmount(v?: { unscaledValue?: string; scale?: string }): number | null {
  if (!v?.unscaledValue) return null;
  const unscaled = Number(v.unscaledValue);
  const scale = Number(v.scale ?? "0");
  if (Number.isNaN(unscaled) || Number.isNaN(scale)) return null;
  return unscaled / Math.pow(10, scale);
}

/** Hämtar summerat banksaldo (booked) över alla konton. */
export async function fetchTinkBalance(
  accessToken: string,
): Promise<{ balance: number; currency: string | null }> {
  const res = await fetch(`${TINK_API_BASE}/data/v2/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tink accounts-anrop misslyckades: ${res.status} ${text}`);
  }
  const json = (await res.json()) as TinkAccountsResponse;
  let total = 0;
  let currency: string | null = null;
  for (const acc of json.accounts ?? []) {
    const bookedAmount = acc.balances?.booked?.amount;
    const value = parseAmount(bookedAmount?.value);
    if (value == null) continue;
    total += value;
    if (!currency && bookedAmount?.currencyCode) currency = bookedAmount.currencyCode;
  }
  return { balance: Math.round(total * 100) / 100, currency };
}
