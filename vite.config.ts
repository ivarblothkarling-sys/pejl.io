// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Registers the Cloudflare `scheduled` (cron trigger) runtime hook — see
  // plugins/cloudflare-scheduled.ts. Not auto-discovered by default in this
  // setup, so it must be listed explicitly.
  //
  // `plugins` isn't in LovableViteTanstackOptions["nitro"]'s declared type —
  // that surface is deliberately narrowed pending Nitro v3 stabilization
  // (see the package's own doc comment: "file an issue if you need more").
  // The underlying nitro/vite call still spreads unknown keys through as-is;
  // verified by inspecting the built .output/server/index.mjs, which
  // contains this plugin's code and the correct dynamic import. Re-verify
  // with a build (grep index.mjs for "startar Fortnox-synk") after upgrading
  // @lovable.dev/vite-tanstack-config or nitro, in case this surface changes.
  nitro: { plugins: ["./plugins/cloudflare-scheduled.ts"] } as unknown as { preset?: string },
  vite: {
    server: {
      port: 8080,
      strictPort: true,
    },
  },
});
