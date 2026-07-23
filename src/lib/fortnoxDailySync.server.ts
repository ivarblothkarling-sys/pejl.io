// Server-only: kör daglig Fortnox-synk för alla kopplingar med ett giltigt
// (icke utgånget) token. Anropas från Cloudflare Workers scheduled-hanteraren
// i src/server.ts — se wrangler.toml för cron-schemat.

const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export async function runDailyFortnoxSync() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { syncFortnoxForUser } = await import("@/lib/api/fortnox.functions");
  const { sendFortnoxSyncFailedEmail } = await import("@/lib/emailAlert.server");

  const { data: connections, error } = await supabaseAdmin
    .from("fortnox_connections")
    .select("user_id, consecutive_sync_failures")
    .gt("expires_at", new Date().toISOString());
  if (error) {
    console.error("[fortnoxDailySync] Kunde inte hämta fortnox_connections:", error.message);
    return { total: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const conn of connections ?? []) {
    try {
      await syncFortnoxForUser(conn.user_id);
      succeeded += 1;
      await supabaseAdmin
        .from("fortnox_connections")
        .update({
          consecutive_sync_failures: 0,
          last_sync_at: new Date().toISOString(),
          last_sync_error: null,
        })
        .eq("user_id", conn.user_id);
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      const failures = (conn.consecutive_sync_failures ?? 0) + 1;
      console.error(
        `[fortnoxDailySync] Sync misslyckades för ${conn.user_id} (försök ${failures} i rad):`,
        message,
      );

      await supabaseAdmin
        .from("fortnox_connections")
        .update({
          consecutive_sync_failures: failures,
          last_sync_at: new Date().toISOString(),
          last_sync_error: message,
        })
        .eq("user_id", conn.user_id);

      if (failures === CONSECUTIVE_FAILURE_THRESHOLD) {
        try {
          const { createNotification } = await import("@/lib/api/notifications.functions");
          await createNotification({
            userId: conn.user_id,
            type: "sync_failed",
            title: "Fortnox-synken har slutat fungera",
            body: message,
          });
        } catch (notifErr) {
          console.error(`[fortnoxDailySync] Kunde inte skapa notis för ${conn.user_id}:`, notifErr);
        }

        try {
          const [{ data: userRes }, { data: profile }] = await Promise.all([
            supabaseAdmin.auth.admin.getUserById(conn.user_id),
            supabaseAdmin
              .from("profiles")
              .select("company_name")
              .eq("id", conn.user_id)
              .maybeSingle(),
          ]);
          const email = userRes.user?.email;
          if (email) {
            await sendFortnoxSyncFailedEmail({
              to: email,
              companyName: profile?.company_name ?? "ditt företag",
              failureReason: message,
            });
          }
        } catch (emailErr) {
          console.error(
            `[fortnoxDailySync] Kunde inte skicka felmejl till ${conn.user_id}:`,
            emailErr,
          );
        }
      }
    }
  }

  const total = connections?.length ?? 0;
  console.log(`[fortnoxDailySync] Klar: ${succeeded} ok, ${failed} misslyckades av ${total}`);
  return { total, succeeded, failed };
}
