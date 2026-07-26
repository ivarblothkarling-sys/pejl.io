// Server-only: kör daglig Fortnox-synk för alla kopplingar med ett giltigt
// (icke utgånget) token. Anropas från Cloudflare Workers scheduled-hanteraren
// i src/server.ts — se wrangler.toml för cron-schemat.
import { computeForecast, formatSEK, type Tx } from "@/lib/forecast";
import { computeTaxEvents } from "@/lib/tax";

const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const LOW_BALANCE_REMINDER_DAYS = 7;
const INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const PAYMENT_OVERDUE_DEDUP_DAYS = 3;
const TAX_REMINDER_DAYS_BEFORE = [7, 2] as const;
const TAX_REMINDER_WINDOW_DAYS = Math.max(...TAX_REMINDER_DAYS_BEFORE);

/**
 * Efter en lyckad synk: hitta kundfakturor som är förfallna (due_date <
 * idag) och fortfarande obetalda (paid_at IS NULL — se paid_at-kommentaren
 * i forecast.ts), och skapa en payment_overdue-notis per faktura — men
 * bara om ingen sådan notis redan skapats för SAMMA faktura de senaste
 * PAYMENT_OVERDUE_DEDUP_DAYS dagarna (kollas via notifications.related_id,
 * inte body-text).
 */
async function checkOverdueInvoicesForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayIso = new Date(todayUtcMs).toISOString().slice(0, 10);

  const { data: overdueRows, error } = await supabaseAdmin
    .from("transactions")
    .select("id, amount, due_date, description")
    .eq("user_id", userId)
    .eq("kind", "income")
    .is("paid_at", null)
    .lt("due_date", todayIso);
  if (error) throw new Error(error.message);
  if (!overdueRows || overdueRows.length === 0) return;

  const dedupCutoffIso = new Date(
    now.getTime() - PAYMENT_OVERDUE_DEDUP_DAYS * 86_400_000,
  ).toISOString();
  const { createNotification } = await import("@/lib/api/notifications.functions");

  for (const tx of overdueRows) {
    try {
      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "payment_overdue")
        .eq("related_id", tx.id)
        .gte("created_at", dedupCutoffIso)
        .limit(1)
        .maybeSingle();
      if (existingErr) throw new Error(existingErr.message);
      if (existing) continue;

      const days = Math.round((todayUtcMs - new Date(tx.due_date).getTime()) / 86_400_000);
      await createNotification({
        userId,
        type: "payment_overdue",
        title: "Försenad betalning",
        body: `Faktura på ${formatSEK(Number(tx.amount))} från ${tx.description} är ${days} dagar försenad.`,
        relatedId: tx.id,
      });
    } catch (txErr) {
      console.error(
        `[fortnoxDailySync] Kunde inte hantera försenad faktura ${tx.id} för ${userId}:`,
        txErr,
      );
    }
  }
}

/**
 * Efter en lyckad synk: skicka en påminnelse (notis + mejl) exakt
 * TAX_REMINDER_DAYS_BEFORE (7 och 2) dagar innan varje skatte-/avgiftsförfall
 * i skattekalendern (se computeTaxEvents i lib/tax.ts). Dedup görs per
 * skattehändelse OCH per påminnelsetröskel via notifications.related_id
 * (`${taxEventId}:${daysBefore}`) — annars skulle 7- och 2-dagarspåminnelsen
 * för samma händelse blockera varandra, eller samma påminnelse skickas om
 * varje dag fram till förfall.
 */
async function checkTaxReminderForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("company_name, country, vat_period")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) throw new Error(profileErr.message);
  if (!profile) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const taxEvents = computeTaxEvents(
    (profile.country ?? "SE") as "SE" | "NO" | "GB" | "US",
    today,
    TAX_REMINDER_WINDOW_DAYS,
    (profile.vat_period ?? "monthly") as "monthly" | "quarterly" | "yearly",
  );
  if (taxEvents.length === 0) return;

  const { createNotification } = await import("@/lib/api/notifications.functions");

  for (const tx of taxEvents) {
    const daysUntilDue = Math.round(
      (new Date(tx.due_date).getTime() - today.getTime()) / 86_400_000,
    );
    if (!TAX_REMINDER_DAYS_BEFORE.includes(daysUntilDue as 7 | 2)) continue;

    const relatedId = `${tx.id}:${daysUntilDue}`;
    try {
      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "tax_reminder")
        .eq("related_id", relatedId)
        .limit(1)
        .maybeSingle();
      if (existingErr) throw new Error(existingErr.message);
      if (existing) continue;

      await createNotification({
        userId,
        type: "tax_reminder",
        title: `${tx.description} förfaller om ${daysUntilDue} dagar`,
        body: `${tx.description}${tx.amount > 0 ? ` på ${formatSEK(tx.amount)}` : ""} förfaller ${tx.due_date}.`,
        relatedId,
      });

      const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(userId);
      const email = userRes.user?.email;
      if (email) {
        const { sendTaxReminderEmail } = await import("@/lib/emailAlert.server");
        const result = await sendTaxReminderEmail({
          to: email,
          companyName: profile.company_name ?? "ditt företag",
          label: tx.description,
          amount: tx.amount,
          dueDate: tx.due_date,
          daysUntilDue,
        });
        if (!result.ok) {
          console.error(
            `[fortnoxDailySync] Kunde inte skicka skattepåminnelse-mejl till ${userId}:`,
            result.error,
          );
        }
      }
    } catch (taxErr) {
      console.error(
        `[fortnoxDailySync] Kunde inte hantera skattepåminnelse ${relatedId} för ${userId}:`,
        taxErr,
      );
    }
  }
}

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
      .select("current_balance, threshold, company_name, last_login_at, country, vat_period")
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
    new Date(),
    ((profile as { country?: string }).country ?? "SE") as "SE" | "NO" | "GB" | "US",
    ((profile as { vat_period?: string }).vat_period ?? "monthly") as
      "monthly" | "quarterly" | "yearly",
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

      try {
        await checkOverdueInvoicesForUser(conn.user_id);
      } catch (overdueErr) {
        console.error(
          `[fortnoxDailySync] Försenad-faktura-koll misslyckades för ${conn.user_id}:`,
          overdueErr,
        );
      }

      try {
        await checkTaxReminderForUser(conn.user_id);
      } catch (taxErr) {
        console.error(
          `[fortnoxDailySync] Skattepåminnelse-koll misslyckades för ${conn.user_id}:`,
          taxErr,
        );
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
