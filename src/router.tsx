import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import * as Sentry from "@sentry/react";
import { routeTree } from "./routeTree.gen";

// getRouter() körs både server- och klientsidan (SSR + hydrering) — Sentry.init
// (browser-SDK) ska bara köras i webbläsaren, och bara en gång.
let sentryInitialized = false;
function initClientSentry() {
  if (sentryInitialized || typeof window === "undefined") return;
  sentryInitialized = true;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, tracesSampleRate: 1.0 });
}

export const getRouter = () => {
  initClientSentry();
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Bryggar TanStack Routers app-brett error boundary till Sentry —
    // fångar ofångade render-fel i valfri route utan en separat
    // <Sentry.ErrorBoundary>-wrapper (som skulle duplicera boundaryn).
    defaultOnCatch: (error, errorInfo) => {
      Sentry.captureReactException(error, errorInfo);
    },
  });

  return router;
};
