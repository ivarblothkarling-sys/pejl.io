// Server-only: kör daglig Fortnox-synk för alla kopplingar med ett giltigt
// (icke utgånget) token. Anropas från Cloudflare Workers scheduled-hanteraren
// i src/server.ts — se wrangler.toml för cron-schemat.
import { computeForecast, formatSEK, type Tx } from "@/lib/forecast";

const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const LOW_BALANCE_REMINDER_DAYS = 7;
const INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Efter en lyckad synk: varna användare som inte varit inne i appen på minst
 * 24 timmar OCH vars 7-dagarsprognos dyker under varningsgränsen — annars
 * märker de det aldrig förrän de själva loggar in. Fristående try/catch per
 * user i anropspunkten så att ett fel här aldrig påverkar synkens egna
 * succeeded/failed-räknare.
 */
async function checkLowBalanceReminderForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: profile, error: profileErr }, { data: txRows, error: txErr }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("current_balance, threshold, company_name, last_login_at")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin.from("transactions").select("*").eq("user_id", userId),
  ]);
  if (profileErr) throw new Error(profileErr.message);
  if (txErr) throw new Error(txErr.message);
  if (!profile) return;

  const lastLoginMs = profile.last_login_at ? new Date(profile.last_login_at).getTime() : null;
  const isInactive = lastLoginMs === null || Date.now() - lastLoginMs > INACTIVITY_THRESHOLD_MS;
  if (!isInactive) return;

  const forecast = computeForecast(
    Number(profile.current_balance) || 0,
    Number(profile.threshold) || 0,
    (txRows ?? []) as Tx[],
    LOW_BALANCE_REMINDER_DAYS,
  );
  if (forecast.minBalance >= forecast.threshold) return;

  const todayUtcMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const minDateMs = new Date(forecast.minDate).getTime();
  const days = Math.max(0, Math.round((minDateMs - todayUtcMs) / 86_400_000));

  const { createNotification } = await import("@/lib/api/notifications.functions");
  try {
    await createNotification({
      userId,
      type: "forecast_warning",
      title: `Kassan kan bli tight om ${days} dagar`,
      body: `Beräknat saldo når ${formatSEK(forecast.minBalance)} den ${forecast.minDate}.`,
    });
  } catch (notifErr) {
    console.error(
      `[fortnoxDailySync] Kunde inte skapa kassavarnings-notis för ${userId}:`,
      notifErr,
    );
  }

  const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = userRes.user?.email;
  if (!email) return;

  const { sendLowBalanceReminderEmail } = await import("@/lib/emailAlert.server");
  const result = await sendLowBalanceReminderEmail({
    to: email,
    companyName: profile.company_name ?? "ditt företag",
    days,
    minBalance: forecast.minBalance,
    minDate: forecast.minDate,
  });
  if (!result.ok) {
    console.error(
      `[fortnoxDailySync] Kunde inte skicka kassavarnings-mejl till ${userId}:`,
      result.error,
    );
  }
}

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

      try {
        await checkLowBalanceReminderForUser(conn.user_id);
      } catch (warnErr) {
        console.error(`[fortnoxDailySync] Kassavarning misslyckades för ${conn.user_id}:`, warnErr);
      }
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
