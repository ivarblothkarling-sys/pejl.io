import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export async function syncFortnoxForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn, error: connErr } = await supabaseAdmin
    .from("fortnox_connections")
    .select("user_id, access_token, refresh_token, expires_at, scope")
    .eq("user_id", userId)
    .maybeSingle();
  if (connErr) throw new Error(connErr.message);
  if (!conn) throw new Error("Ingen Fortnox-koppling hittad för den här användaren.");

  const { ensureFreshFortnoxToken, fetchFortnoxOpenTransactions, fetchFortnoxFullyPaidInvoices } =
    await import("@/lib/fortnoxApi.server");
  const accessToken = await ensureFreshFortnoxToken(conn);
  const [{ companyName, transactions }, paidInvoices] = await Promise.all([
    fetchFortnoxOpenTransactions(accessToken),
    fetchFortnoxFullyPaidInvoices(accessToken),
  ]);

  // 1) Markera fakturor som blivit fullbetalda sedan de senast synkades som
  // öppna — matchas mot befintliga rader via external_id (Fortnox
  // dokument-/fakturanummer), inte en blind delete/insert, så att paid_at
  // faktiskt sparas istället för att skrivas över nästa gång steg 2 körs.
  for (const p of paidInvoices) {
    const { error } = await supabaseAdmin
      .from("transactions")
      .update({ paid: true, paid_at: p.finalPayDate })
      .eq("user_id", userId)
      .eq("source", "fortnox")
      .eq("external_id", p.externalId);
    if (error) throw new Error(error.message);
  }

  // 2) Ta bort gamla öppna Fortnox-rader (och mock-data) — men rör aldrig
  // rader som precis markerades betalda i steg 1.
  const paidExternalIds = new Set(paidInvoices.map((p) => p.externalId));
  const { data: existingFortnoxRows, error: existingErr } = await supabaseAdmin
    .from("transactions")
    .select("id, external_id")
    .eq("user_id", userId)
    .eq("source", "fortnox");
  if (existingErr) throw new Error(existingErr.message);

  const staleIds = (existingFortnoxRows ?? [])
    .filter((row) => !row.external_id || !paidExternalIds.has(row.external_id))
    .map((row) => row.id);
  if (staleIds.length > 0) {
    const { error } = await supabaseAdmin.from("transactions").delete().in("id", staleIds);
    if (error) throw new Error(error.message);
  }
  const { error: mockDelErr } = await supabaseAdmin
    .from("transactions")
    .delete()
    .eq("user_id", userId)
    .eq("source", "mock");
  if (mockDelErr) throw new Error(mockDelErr.message);

  // 3) Infoga färska öppna fakturor.
  if (transactions.length > 0) {
    const rows = transactions.map((t) => ({
      user_id: userId,
      external_id: t.externalId,
      kind: t.kind,
      amount: t.amount,
      due_date: t.dueDate,
      description: t.description,
      paid: false,
      source: "fortnox",
      approval_status: t.approvalStatus ?? "approved",
    }));
    const { error: insErr } = await supabaseAdmin.from("transactions").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }

  if (companyName) {
    await supabaseAdmin
      .from("profiles")
      .update({ company_name: companyName, updated_at: new Date().toISOString() })
      .eq("id", userId);
  }

  return { imported: transactions.length, markedPaid: paidInvoices.length, companyName };
}

export const getFortnoxAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { redirectUri?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const fortnoxScopes = [
      "companyinformation",
      "invoice",
      "supplierinvoice",
      "bookkeeping",
      "payment",
      "customer",
    ].join(" ");
    // Läs server-side env (aldrig import.meta.env för secrets).
    const clientId = process.env.FORTNOX_CLIENT_ID;
    const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
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
    if (!clientSecret) {
      console.error("[Fortnox] FORTNOX_CLIENT_SECRET saknas i process.env.");
      throw new Error(
        "Fortnox är inte konfigurerad — FORTNOX_CLIENT_SECRET saknas i miljövariablerna.",
      );
    }
    const { createFortnoxState } = await import("@/lib/fortnoxState.server");
    const state = createFortnoxState(context.userId, clientSecret);
    const redirectUri =
      data?.redirectUri && /^https?:\/\//.test(data.redirectUri)
        ? data.redirectUri
        : (process.env.FORTNOX_REDIRECT_URI ??
          "https://pejl.io/auth/fortnox/callback");
    console.log("[Fortnox] Bygger OAuth-URL med redirectUri:", redirectUri);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: fortnoxScopes,
      state,
      response_type: "code",
      access_type: "offline",
    });
    const url = `https://apps.fortnox.se/oauth-v1/auth?${params.toString()}`;
    console.log("[Fortnox] OAuth-URL genererad för Fortnox.");
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
  .inputValidator(
    z.object({
      code: z.string().min(1),
      state: z.string().min(1),
      redirectUri: z.string().url().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const fortnoxScopes = [
      "companyinformation",
      "invoice",
      "supplierinvoice",
      "bookkeeping",
      "payment",
      "customer",
    ].join(" ");
    const clientId = process.env.FORTNOX_CLIENT_ID;
    const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "Fortnox är inte konfigurerad — kontrollera FORTNOX_CLIENT_ID och FORTNOX_CLIENT_SECRET.",
      );
    }

    const { verifyFortnoxState } = await import("@/lib/fortnoxState.server");
    const statePayload = verifyFortnoxState(data.state, clientSecret);

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const redirectUri =
      data.redirectUri && /^https?:\/\//.test(data.redirectUri)
        ? data.redirectUri
        : (process.env.FORTNOX_REDIRECT_URI ??
          "https://pejl.io/auth/fortnox/callback");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: data.code,
      redirect_uri: redirectUri,
    });

    const res = await fetch("https://apps.fortnox.se/oauth-v1/token", {
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upsertErr } = await supabaseAdmin
      .from("fortnox_connections")
      .upsert(
        {
          user_id: statePayload.userId,
          access_token: json.access_token,
          refresh_token: json.refresh_token,
          expires_at: expiresAt,
          scope: json.scope ?? fortnoxScopes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (upsertErr) throw new Error(upsertErr.message);

    // Kör en initial synk direkt så användaren ser riktig Fortnox-data
    // så snart hen kommer tillbaka till dashboarden.
    let imported = 0;
    try {
      const result = await syncFortnoxForUser(statePayload.userId);
      imported = result.imported;
    } catch (err) {
      console.error("[Fortnox] Initial synk efter OAuth misslyckades:", err);
    }

    return { ok: true, imported };
  });

export const syncFortnox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return syncFortnoxForUser(context.userId);
  });

export const disconnectFortnox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Ta bort både kopplingen och Fortnox-hämtade transaktioner.
    const [{ error: connErr }, { error: txErr }] = await Promise.all([
      supabaseAdmin.from("fortnox_connections").delete().eq("user_id", context.userId),
      supabaseAdmin
        .from("transactions")
        .delete()
        .eq("user_id", context.userId)
        .eq("source", "fortnox"),
    ]);
    if (connErr) throw new Error(connErr.message);
    if (txErr) throw new Error(txErr.message);
    return { ok: true };
  });
