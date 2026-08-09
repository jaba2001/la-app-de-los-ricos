// Sentry — Edge runtime. This is the one that matters most here: every browser-facing
// route in this proxy declares `export const runtime = 'edge'`.
//
// No SENTRY_DSN → init is a no-op. Same contract as lib/email.js and lib/ratelimit.js:
// a missing integration degrades to silence, never to a broken route.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
});
