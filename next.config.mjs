import { withSentryConfig } from '@sentry/nextjs';

// This project serves API routes only — there is no React tree to catch render errors in,
// so Sentry's "add a global-error.js" recommendation doesn't apply. Silenced here rather
// than adding a decorative file, because a warning printed on every single build is how
// people learn to stop reading build output.
process.env.SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING = '1';

const nextConfig = {};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // The build must stay green and quiet without Sentry credentials.
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Strips Sentry's debug logging from the bundle (replaces the deprecated disableLogger).
  webpack: { treeshake: { removeDebugLogging: true } },
  telemetry: false,
});
