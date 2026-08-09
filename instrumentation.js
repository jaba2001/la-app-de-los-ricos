// Next.js instrumentation hook — loads the right Sentry config per runtime.
// There is no instrumentation-client here: ic-proxy serves API routes only, no pages.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config.js');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config.js');
  }
}

export const onRequestError = Sentry.captureRequestError;
