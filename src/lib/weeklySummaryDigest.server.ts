// Server-only: skickar veckobrevet till alla användare med en giltig
// (icke utgången) Fortnox-koppling. Anropas från Cloudflare Workers
// scheduled-hanteraren i plugins/cloudflare-scheduled.ts — se wrangler.toml
// för cron-schemat (måndagar).
import type { Tx } from "@/lib/forecast";

export async function runWeeklySummaryDigest() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { buildWeeklySummary } = await import("@/lib/api/finance.functions");
  const { sendWeeklySummaryEmail } = await import("@/lib/emailAlert.server");

  const { data: connections, error } = await supabaseAdmin
    .from("fortnox_connections")
    .select("user_id")
    .gt("expires_at", new Date().toISOString());
  if (error) {
    console.error("[weeklySummaryDigest] Kunde inte hämta fortnox_connections:", error.message);
    return { total: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const conn of connections ?? []) {
    try {
      const [
        { data: userRes },
        { data: profile, error: profileErr },
        { data: txRows, error: txErr },
      ] = await Promise.all([
        supabaseAdmin.auth.admin.getUserById(conn.user_id),
        supabaseAdmin.from("profiles").select("*").eq("id", conn.user_id).maybeSingle(),
        supabaseAdmin.from("transactions").select("*").eq("user_id", conn.user_id),
      ]);
      if (profileErr) throw new Error(profileErr.message);
      if (txErr) throw new Error(txErr.message);

      const email = userRes.user?.email;
      if (!email) {
        console.error(
          `[weeklySummaryDigest] Ingen e-post hittades för ${conn.user_id}, hoppar över.`,
        );
        continue;
      }

      const { summary, forecast } = await buildWeeklySummary(
        profile ?? {
          current_balance: 0,
          threshold: 0,
          company_name: "ditt företag",
          country: "SE",
        },
        (txRows ?? []) as Tx[],
      );

      const result = await sendWeeklySummaryEmail({
        to: email,
        companyName: profile?.company_name ?? "ditt företag",
        summary,
        forecast,
      });
      if (!result.ok) throw new Error(result.error);

      sent += 1;
      await supabaseAdmin
        .from("profiles")
        .update({ last_weekly_summary_sent_at: new Date().toISOString() })
        .eq("id", conn.user_id);

      try {
        const { createNotification } = await import("@/lib/api/notifications.functions");
        await createNotification({
          userId: conn.user_id,
          type: "weekly_summary",
          title: "Ditt veckobrev är klart",
          body: summary,
        });
      } catch (notifErr) {
        console.error(
          `[weeklySummaryDigest] Kunde inte skapa notis för ${conn.user_id}:`,
          notifErr,
        );
      }
    } catch (err) {
      failed += 1;
      console.error(`[weeklySummaryDigest] Misslyckades för ${conn.user_id}:`, err);
    }
  }

  const total = connections?.length ?? 0;
  console.log(`[weeklySummaryDigest] Klar: ${sent} skickade, ${failed} misslyckades av ${total}`);
  return { total, sent, failed };
}
