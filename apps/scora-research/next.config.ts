import withPWA from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// El backend es parte de esta app, así que `'self'` del connect-src ya lo cubre. La
// variable sólo añade un origen al CSP si algún día se apunta a un backend externo.
const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "";
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
  // Empaqueta el servidor y solo las dependencias que usa en .next/standalone, para que la
  // imagen de contenedor no lleve los 573 paquetes de node_modules.
  output: "standalone",
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
  // Poda del SDK en el bundle. `removeDebugLogging` reemplaza al antiguo disableLogger.
  //
  // `removeTracing` quita el codigo de performance monitoring, y es el unico cambio de esta
  // configuracion que se NOTA en el arranque: la base compartida baja de 188 kB a 139 kB y
  // /stock/[ticker] de 348 a 299 (medido con `next build`, no estimado). Todas las paginas
  // pagaban esos 49 kB porque Sentry va en el chunk compartido.
  //
  // QUE SE PIERDE: las trazas de rendimiento de Sentry. NO se pierde el reporte de errores,
  // que es para lo que esta puesto. El rendimiento ya lo miden Vercel Speed Insights y
  // PostHog, ambos ya instalados, y el muestreo estaba al 10% justamente porque la cuota
  // gratuita de Sentry no aguanta mas (ver instrumentation-client.ts).
  //
  // PARA REVERTIRLO: quitar `removeTracing` de aqui. Nada mas depende de ello.
  //
  // Se probaron tambien excludeReplay{ShadowDom,Iframe,Worker}: CERO efecto medido, porque
  // la integracion de Replay nunca se anadio y ese codigo no llega al bundle. No se dejan
  // puestas para no sugerir que hacen algo.
  webpack: { treeshake: { removeDebugLogging: true, removeTracing: true } },
  telemetry: false,
});
