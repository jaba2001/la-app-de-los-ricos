// Next.js instrumentation hook — loads the right Sentry config per runtime and
// forwards server-side request errors. Client-side init lives in
// instrumentation-client.ts (Sentry v10 convention).
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
