// Sentry — browser. Sentry v10 loads this file automatically for the client bundle.
//
// No DSN → Sentry.init is a no-op and nothing is sent. Same defensive contract as
// lib/analytics.ts and lib/push.ts: the app behaves identically with and without
// error reporting configured.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  // 10% of transactions. The free tier is small and Scora's stock page fires ~30
  // parallel fetches per view — full tracing would exhaust the quota in days.
  tracesSampleRate: 0.1,
  // Session Replay off: it records DOM, and the DOM here contains a user's real
  // watchlist and trade journal. Not worth the privacy surface for a research app.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
  environment: process.env.NODE_ENV,
});

// Required by the Sentry SDK to instrument App Router navigations. Without it every build
// prints an "ACTION REQUIRED" warning and client-side route changes aren't traced.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
