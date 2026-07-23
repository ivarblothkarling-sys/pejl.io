// Nitro runtime-hook plugin — dispatches Cloudflare Cron Triggers to the
// right scheduled job based on which cron expression fired. Registered
// explicitly via `nitro.plugins` in vite.config.ts (not auto-discovered by
// default in this project's setup). Cron schedules live in wrangler.toml
// under [triggers] — must match the strings switched on below exactly.
import { definePlugin } from "nitro";

const DAILY_FORTNOX_SYNC_CRON = "0 5 * * *";
const WEEKLY_SUMMARY_CRON = "0 6 * * 1";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", ({ controller, context }) => {
    const cron = (controller as { cron?: string })?.cron;
    const ctx = context as { waitUntil: (p: Promise<unknown>) => void };

    if (cron === DAILY_FORTNOX_SYNC_CRON) {
      console.log(`[scheduled] Cron-trigger (${cron}) — startar Fortnox-synk.`);
      ctx.waitUntil(
        import("@/lib/fortnoxDailySync.server")
          .then((m) => m.runDailyFortnoxSync())
          .catch((error) => {
            console.error("[scheduled] Daglig Fortnox-sync misslyckades:", error);
          }),
      );
      return;
    }

    if (cron === WEEKLY_SUMMARY_CRON) {
      console.log(`[scheduled] Cron-trigger (${cron}) — skickar veckobrev.`);
      ctx.waitUntil(
        import("@/lib/weeklySummaryDigest.server")
          .then((m) => m.runWeeklySummaryDigest())
          .catch((error) => {
            console.error("[scheduled] Veckobrev misslyckades:", error);
          }),
      );
      return;
    }

    console.warn(`[scheduled] Okänd cron-trigger (${cron ?? "saknas"}) — ingen hanterare matchade.`);
  });
});
