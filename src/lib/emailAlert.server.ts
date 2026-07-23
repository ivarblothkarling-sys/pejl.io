// Server-only helper: send low-balance alert emails via Resend API.
// Uses a shared RESEND_API_KEY env variable so emails work for all users,
// independent of who owns the workspace connector.
import { formatSEK } from "./forecast";
import type { ForecastResult } from "./forecast";

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Pejl <alerts@pejl.io>";

export type LowBalanceEmailInput = {
  to: string;
  companyName: string;
  forecast: ForecastResult;
};

export async function sendLowBalanceEmail({ to, companyName, forecast }: LowBalanceEmailInput) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[emailAlert] Missing RESEND_API_KEY");
    return { ok: false as const, error: "missing_keys" };
  }
  if (!forecast.breachDate || forecast.breachAmount === null) {
    return { ok: false as const, error: "no_breach" };
  }

  const dateSv = new Date(forecast.breachDate).toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const belopp = formatSEK(forecast.breachAmount);
  const grans = formatSEK(forecast.threshold);
  const minSaldo = formatSEK(forecast.minBalance);

  const subject = `Varning: ${companyName} riskerar gå under likviditetsgränsen ${dateSv}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h1 style="font-size:20px;margin:0 0 16px">⚠️ Likviditetsvarning från Pejl</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
        Hej! Prognosen för <strong>${companyName}</strong> visar att ditt saldo riskerar att gå under din varningsgräns.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:8px 0;color:#64748b">Datum</td><td style="padding:8px 0;text-align:right"><strong>${dateSv}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Prognostiserat saldo</td><td style="padding:8px 0;text-align:right;color:#dc2626"><strong>${belopp}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Din varningsgräns</td><td style="padding:8px 0;text-align:right"><strong>${grans}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Lägsta saldo kommande 30 dagar</td><td style="padding:8px 0;text-align:right"><strong>${minSaldo}</strong></td></tr>
      </table>
      <p style="font-size:14px;line-height:1.5;color:#475569;margin:16px 0">
        <strong>Orsak:</strong> Utgifterna fram till förfallodatum överstiger inkommande betalningar och nuvarande saldo. Titta på förslagen i Pejl för att skjuta upp leverantörsbetalningar eller påminna kunder om obetalda fakturor.
      </p>
      <a href="https://pejl-cash-flow-buddy.lovable.app/dashboard"
         style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
        Öppna Pejl →
      </a>
      <p style="font-size:12px;color:#94a3b8;margin-top:32px">
        Du får detta mejl eftersom du har aktiverat likviditetsvarningar i Pejl.
      </p>
    </div>
  `;

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[emailAlert] Resend ${res.status}: ${body}`);
      return { ok: false as const, error: `resend_${res.status}` };
    }
    return { ok: true as const };
  } catch (err) {
    console.error("[emailAlert] fetch failed", err);
    return { ok: false as const, error: "fetch_failed" };
  }
}

export type FortnoxSyncFailedEmailInput = {
  to: string;
  companyName: string;
  failureReason: string;
};

/** Skickas när den dagliga Fortnox-synken har misslyckats flera gånger i rad för en användare. */
export async function sendFortnoxSyncFailedEmail({
  to,
  companyName,
  failureReason,
}: FortnoxSyncFailedEmailInput) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[emailAlert] Missing RESEND_API_KEY");
    return { ok: false as const, error: "missing_keys" };
  }

  const subject = `Fortnox-synkningen för ${companyName} har misslyckats`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h1 style="font-size:20px;margin:0 0 16px">⚠️ Fortnox-synken har slutat fungera</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
        Hej! Den automatiska dagliga synken mot Fortnox för <strong>${companyName}</strong> har
        misslyckats flera dagar i rad. Prognosen i Pejl kan vara inaktuell tills kopplingen är
        återställd.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:8px 0;color:#64748b">Senaste felmeddelande</td><td style="padding:8px 0;text-align:right;color:#dc2626"><strong>${failureReason}</strong></td></tr>
      </table>
      <p style="font-size:14px;line-height:1.5;color:#475569;margin:16px 0">
        Vanligast är att Fortnox-kopplingen behöver återanslutas. Gå till Inställningar i Pejl och
        koppla Fortnox på nytt.
      </p>
      <a href="https://pejl.io/installningar"
         style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
        Öppna inställningar →
      </a>
      <p style="font-size:12px;color:#94a3b8;margin-top:32px">
        Du får detta mejl eftersom din Fortnox-koppling i Pejl inte kunnat synkas automatiskt.
      </p>
    </div>
  `;

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[emailAlert] Resend ${res.status}: ${body}`);
      return { ok: false as const, error: `resend_${res.status}` };
    }
    return { ok: true as const };
  } catch (err) {
    console.error("[emailAlert] fetch failed", err);
    return { ok: false as const, error: "fetch_failed" };
  }
}

export type WeeklySummaryEmailInput = {
  to: string;
  companyName: string;
  summary: string;
  forecast: ForecastResult;
};

/** Skickas av det schemalagda veckobrevet (måndagar) — se weeklySummaryDigest.server.ts. */
export async function sendWeeklySummaryEmail({
  to,
  companyName,
  summary,
  forecast,
}: WeeklySummaryEmailInput) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[emailAlert] Missing RESEND_API_KEY");
    return { ok: false as const, error: "missing_keys" };
  }

  const dateSv = new Date().toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const subject = `Ditt veckobrev från Pejl — ${dateSv}`;
  // summary kommer från Claude via generateText (fri text, ingen HTML) —
  // radbryt till <p>-taggar men lita inte på att den innehåller egen HTML.
  const summaryHtml = summary
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${para.replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h1 style="font-size:20px;margin:0 0 16px">📊 Veckobrev från Pejl</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
        Hej! Här är veckans sammanfattning för <strong>${companyName}</strong>.
      </p>
      ${summaryHtml}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:8px 0;color:#64748b">Dagens saldo</td><td style="padding:8px 0;text-align:right"><strong>${formatSEK(forecast.startBalance)}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Prognos om 30 dagar</td><td style="padding:8px 0;text-align:right"><strong>${formatSEK(forecast.endBalance)}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Lägsta saldo (30 dagar)</td><td style="padding:8px 0;text-align:right"><strong>${formatSEK(forecast.minBalance)}</strong></td></tr>
      </table>
      <a href="https://pejl.io/dashboard"
         style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
        Öppna Pejl →
      </a>
      <p style="font-size:12px;color:#94a3b8;margin-top:32px">
        Du får detta mejl varje måndag eftersom du har en aktiv Fortnox-koppling i Pejl.
      </p>
    </div>
  `;

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[emailAlert] Resend ${res.status}: ${body}`);
      return { ok: false as const, error: `resend_${res.status}` };
    }
    return { ok: true as const };
  } catch (err) {
    console.error("[emailAlert] fetch failed", err);
    return { ok: false as const, error: "fetch_failed" };
  }
}
