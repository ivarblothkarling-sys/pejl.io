// Nitro runtime-hook plugin — dispatches Cloudflare Cron Triggers to our
// daily Fortnox sync. Registered explicitly via `nitro.plugins` in
// vite.config.ts (not auto-discovered by default in this project's setup).
// Cron schedule itself lives in wrangler.toml under [triggers].
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", ({ controller, context }) => {
    const cron = (controller as { cron?: string })?.cron ?? "okänt schema";
    console.log(`[scheduled] Cron-trigger (${cron}) — startar Fortnox-synk.`);
    const run = import("@/lib/fortnoxDailySync.server")
      .then((m) => m.runDailyFortnoxSync())
      .catch((error) => {
        console.error("[scheduled] Daglig Fortnox-sync misslyckades:", error);
      });
    (context as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(run);
  });
});
