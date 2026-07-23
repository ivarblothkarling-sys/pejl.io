import "./lib/error-capture";

import * as Sentry from "@sentry/cloudflare";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type WorkerEnv = { SENTRY_DSN?: string };

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const handler = {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const server = await getServerEntry();
      const response = await server.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      Sentry.captureException(error);
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

// withSentry initierar SDK:t per request (Cloudflare Workers binder env vid
// request-tid, inte vid modul-laddning — se config.server.ts) och wrappar
// fetch-hanteraren så ofångade fel och spans rapporteras automatiskt.
export default Sentry.withSentry<WorkerEnv>(
  (env) => ({
    // env kan vara undefined i lokal Vite dev-server (inga riktiga Cloudflare
    // env-bindings där) — optional chaining så lokal utveckling inte kraschar
    // på varje request när SENTRY_DSN inte är satt.
    dsn: env?.SENTRY_DSN,
    tracesSampleRate: 1.0,
  }),
  handler,
);
