// Fortnox API-hjälpare — token-refresh och hämtning av fakturor/leverantörsfakturor.
// Får endast importeras från server-only kod (server functions).

const FORTNOX_API_BASE = "https://api.fortnox.se/3";
const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";

export interface FortnoxConnectionRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
  scope: string | null;
}

export interface FortnoxTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
  scope: string | null;
}

/**
 * Refresh access-token mot Fortnox. Returnerar de nya tokensen (Fortnox
 * roterar refresh_token vid varje refresh).
 */
export async function refreshFortnoxTokens(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<FortnoxTokens> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
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
    throw new Error(`Fortnox refresh misslyckades: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : null,
    scope: json.scope ?? null,
  };
}

/**
 * Se till att kopplingen har ett giltigt access-token. Om det är utgånget
 * (eller går ut inom 60s) — refresha och spara det nya paret i databasen.
 */
export async function ensureFreshFortnoxToken(
  conn: FortnoxConnectionRow,
): Promise<string> {
  const clientId = process.env.FORTNOX_CLIENT_ID;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Fortnox är inte konfigurerad — saknar CLIENT_ID/SECRET.");
  }

  const expiresAt = conn.expires_at ? Date.parse(conn.expires_at) : 0;
  const stillValid = expiresAt && expiresAt - Date.now() > 60_000;
  if (stillValid) return conn.access_token;

  console.log("[Fortnox] Access-token utgånget — refreshar mot Fortnox.");
  const fresh = await refreshFortnoxTokens(
    conn.refresh_token,
    clientId,
    clientSecret,
  );

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("fortnox_connections")
    .update({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: fresh.expires_at,
      scope: fresh.scope ?? conn.scope,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", conn.user_id);
  if (error) throw new Error(error.message);

  return fresh.access_token;
}

async function fortnoxGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${FORTNOX_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fortnox GET ${path} misslyckades: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

// ---- Fortnox response-typer (bara det vi läser) ----
interface FortnoxInvoiceListItem {
  DocumentNumber?: string;
  CustomerName?: string;
  Total?: number;
  Balance?: number;
  DueDate?: string;
  Cancelled?: boolean;
  FinalPayDate?: string | null;
}
interface FortnoxInvoicesResponse {
  Invoices?: FortnoxInvoiceListItem[];
}
interface FortnoxSupplierInvoiceListItem {
  GivenNumber?: string;
  SupplierName?: string;
  Total?: number;
  Balance?: number;
  DueDate?: string;
  Cancelled?: boolean;
  FinalPayDate?: string | null;
  Booked?: boolean;
  AuthorizerName?: string | null;
}
interface FortnoxSupplierInvoicesResponse {
  SupplierInvoices?: FortnoxSupplierInvoiceListItem[];
}
interface FortnoxCompanyInformationResponse {
  CompanyInformation?: { CompanyName?: string };
}

export interface FortnoxFetchedTx {
  externalId: string;
  kind: "income" | "expense";
  amount: number;
  dueDate: string;
  description: string;
  approvalStatus?: "approved" | "pending_approval";
}

/** Hämtar öppna kund- och leverantörsfakturor och normaliserar till Tx-shape. */
export async function fetchFortnoxOpenTransactions(
  accessToken: string,
): Promise<{ companyName: string | null; transactions: FortnoxFetchedTx[] }> {
  const [invRes, supRes, companyRes] = await Promise.all([
    fortnoxGet<FortnoxInvoicesResponse>(
      "/invoices?filter=unpaid",
      accessToken,
    ),
    fortnoxGet<FortnoxSupplierInvoicesResponse>(
      "/supplierinvoices?filter=unpaid",
      accessToken,
    ),
    fortnoxGet<FortnoxCompanyInformationResponse>(
      "/companyinformation",
      accessToken,
    ).catch(() => ({}) as FortnoxCompanyInformationResponse),
  ]);

  const transactions: FortnoxFetchedTx[] = [];

  for (const inv of invRes.Invoices ?? []) {
    if (inv.Cancelled) continue;
    const amount = Number(inv.Balance ?? inv.Total ?? 0);
    if (!amount || !inv.DueDate) continue;
    transactions.push({
      externalId: `inv-${inv.DocumentNumber ?? crypto.randomUUID()}`,
      kind: "income",
      amount,
      dueDate: inv.DueDate,
      description: `Kundfaktura #${inv.DocumentNumber ?? ""} — ${inv.CustomerName ?? "Okänd kund"}`.trim(),
    });
  }

  for (const sup of supRes.SupplierInvoices ?? []) {
    if (sup.Cancelled) continue;
    const amount = Number(sup.Balance ?? sup.Total ?? 0);
    if (!amount || !sup.DueDate) continue;
    transactions.push({
      externalId: `sup-${sup.GivenNumber ?? crypto.randomUUID()}`,
      kind: "expense",
      amount,
      dueDate: sup.DueDate,
      description: `Leverantörsfaktura #${sup.GivenNumber ?? ""} — ${sup.SupplierName ?? "Okänd leverantör"}`.trim(),
    });
  }

  return {
    companyName: companyRes.CompanyInformation?.CompanyName ?? null,
    transactions,
  };
}
