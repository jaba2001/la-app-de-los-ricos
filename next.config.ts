import withPWA from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "https://ic-proxy-psi.vercel.app";
// Observability endpoints must be allowlisted in connect-src or the CSP below blocks
// them SILENTLY — no console error the user would report, just zero events arriving.
// Keep this default in sync with lib/analytics.ts.
const POSTHOG = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
// Sentry DSNs resolve to o<org>.ingest.sentry.io (US) or o<org>.ingest.de.sentry.io (EU);
// both are listed so the region can change without a code edit.
const SENTRY_INGEST = "https://*.ingest.sentry.io https://*.ingest.de.sentry.io";

// The Supabase session lives in localStorage, so any XSS is a full account takeover —
// CSP is the mitigation that was missing entirely (only HSTS was being served).
//
// script-src needs 'unsafe-inline' because Next's App Router emits inline hydration
// scripts (self.__next_f.push) and we don't run a nonce middleware; 'unsafe-eval' is
// deliberately absent. Upgrading to nonces means adding middleware.ts and giving up
// static optimisation — worth doing if the app ever renders third-party content.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // 'self' also covers Vercel Analytics + Speed Insights (they post to /_vercel/*).
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${PROXY} ${POSTHOG} ${SENTRY_INGEST}`,
  "worker-src 'self'",       // PWA service worker
  "manifest-src 'self'",
  "frame-ancestors 'none'",  // clickjacking — the app was embeddable
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // There is a package-lock.json both here and in the repo root, so Next guesses at the
  // workspace root and warns on every build. Pointing it at this project silences the
  // warning and, more importantly, keeps build tracing scoped to the files this app
  // actually uses instead of the whole parent tree.
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

const withPwaConfig = withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  // Load our Web Push handlers into the generated service worker.
  workboxOptions: { importScripts: ["/push-sw.js"] },
})(nextConfig);

// ORDER MATTERS: Sentry wraps the PWA-wrapped config, never the reverse. next-pwa
// generates public/sw.js from the final webpack output, so it must stay innermost.
// After touching this, confirm public/sw.js still regenerates on `next build`.
export default withSentryConfig(withPwaConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // The build must stay green and quiet for anyone without Sentry credentials.
  silent: true,
  // Source maps can only be uploaded with an auth token — skip cleanly without one.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Strips Sentry's debug logging from the bundle (replaces the deprecated disableLogger).
  webpack: { treeshake: { removeDebugLogging: true } },
  telemetry: false,
});
