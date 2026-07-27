// Server-only: skickar den månatliga PDF-rapporten för alla BOLAG
// (user_companies) med en giltig (icke utgången) Fortnox-koppling, plus till
// deras kopplade redovisningsbyrå om en sådan finns (byrå-kopplingen är
// fortfarande per ANVÄNDARE, inte per bolag — se agency.functions.ts).
// Anropas från Cloudflare Workers scheduled-hanteraren i
// plugins/cloudflare-scheduled.ts — se wrangler.toml för cron-schemat
// (1:a varje månad).
import type { Tx } from "@/lib/forecast";

export async function runMonthlyReportDigest() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { buildMonthlyReportData, renderMonthlyReportPdf } = await import("@/lib/report.server");
  const { sendMonthlyReportEmail } = await import("@/lib/emailAlert.server");

  const { data: connections, error } = await supabaseAdmin
    .from("fortnox_connections")
    .select("user_id, company_id")
    .gt("expires_at", new Date().toISOString());
  if (error) {
    console.error("[monthlyReportDigest] Kunde inte hämta fortnox_connections:", error.message);
    return { total: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const conn of connections ?? []) {
    const companyId = conn.company_id;
    if (!companyId) continue;

    try {
      const [
        { data: userRes },
        { data: company, error: companyErr },
        { data: txRows, error: txErr },
      ] = await Promise.all([
        supabaseAdmin.auth.admin.getUserById(conn.user_id),
        supabaseAdmin.from("user_companies").select("*").eq("id", companyId).maybeSingle(),
        supabaseAdmin.from("transactions").select("*").eq("company_id", companyId),
      ]);
      if (companyErr) throw new Error(companyErr.message);
      if (txErr) throw new Error(txErr.message);

      const userEmail = userRes.user?.email;
      if (!userEmail) {
        console.error(
          `[monthlyReportDigest] Ingen e-post hittades för ${conn.user_id}, hoppar över.`,
        );
        continue;
      }

      const companyName = company?.company_name ?? "ditt företag";
      const reportData = buildMonthlyReportData(
        company ?? { current_balance: 0, threshold: 0, company_name: companyName, country: "SE" },
        (txRows ?? []) as Tx[],
      );
      const pdfBytes = await renderMonthlyReportPdf(reportData);
      const pdfBase64 = Buffer.from(pdfBytes).toString("base64");
      const filename = `pejl-manadsrapport-${reportData.periodStart.slice(0, 7)}.pdf`;

      // Om användaren är kopplad till en redovisningsbyrå (agency_clients.
      // client_user_id) — skicka till byråns e-post också, inte bara
      // användarens egen.
      const recipients = [userEmail];
      const { data: agencyLink } = await supabaseAdmin
        .from("agency_clients")
        .select("agency_user_id")
        .eq("client_user_id", conn.user_id)
        .maybeSingle();
      if (agencyLink?.agency_user_id) {
        const { data: agencyUserRes } = await supabaseAdmin.auth.admin.getUserById(
          agencyLink.agency_user_id,
        );
        if (agencyUserRes.user?.email && agencyUserRes.user.email !== userEmail) {
          recipients.push(agencyUserRes.user.email);
        }
      }

      const result = await sendMonthlyReportEmail({
        to: recipients,
        companyName,
        periodLabel: reportData.periodLabel,
        pdfBase64,
        filename,
      });
      if (!result.ok) throw new Error(result.error);

      sent += 1;

      try {
        const { createNotification } = await import("@/lib/api/notifications.functions");
        await createNotification({
          userId: conn.user_id,
          type: "monthly_report",
          title: `Månadsrapporten för ${companyName} (${reportData.periodLabel}) är klar`,
          body: `Skickad till ${recipients.join(", ")}.`,
        });
      } catch (notifErr) {
        console.error(
          `[monthlyReportDigest] Kunde inte skapa notis för bolag ${companyId}:`,
          notifErr,
        );
      }
    } catch (err) {
      failed += 1;
      console.error(`[monthlyReportDigest] Misslyckades för bolag ${companyId}:`, err);
    }
  }

  const total = connections?.length ?? 0;
  console.log(`[monthlyReportDigest] Klar: ${sent} skickade, ${failed} misslyckades av ${total}`);
  return { total, sent, failed };
}
