// Sentry — browser. Sentry v10 loads this file automatically for the client bundle.
//
// No DSN → Sentry.init is a no-op and nothing is sent. Same defensive contract as
// lib/analytics.ts and lib/push.ts: the app behaves identically with and without
// error reporting configured.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  // El performance monitoring esta PODADO DEL BUNDLE en next.config.ts
  // (webpack.treeshake.removeTracing) porque costaba 49 kB en el arranque de todas las
  // paginas. Este valor no hace nada mientras eso siga asi; se deja escrito para que, al
  // revertir aquello, el muestreo vuelva a ser el que estaba decidido y no el 100% por
  // defecto — que era justo lo que agotaba la cuota gratuita en dias.
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
