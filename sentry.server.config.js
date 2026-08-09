// Sentry — Node runtime. Used by the cron routes that need Node APIs (web-push).
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
});
