// ─────────────────────────────────────────────────────────────────────────────
// Product analytics (PostHog). Thin, typed wrapper over posthog-js.
//
// Same defensive contract as lib/push.ts and ic-proxy/lib/email.js: if
// NEXT_PUBLIC_POSTHOG_KEY is unset, every function here is a no-op. The app must
// behave identically with and without analytics configured — a metrics outage is
// never allowed to surface as a broken feature.
//
// Deliberately NOT using autocapture: with 13 stock tabs and 12 macro tabs, blind
// DOM capture produces noise, not signal. Every event below is explicit and named,
// so the schema stays small enough to actually reason about.
//
// Privacy: we identify by the Supabase user UUID, never by email. No PII leaves
// the app, and the UUID still joins back to Supabase for follow-up analysis.
// ─────────────────────────────────────────────────────────────────────────────
import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || "";
// EU host by default — keeps analytics data in the EU unless explicitly overridden.
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

/** True once posthog.init has actually run (client-side, key present). */
let ready = false;

export function analyticsConfigured(): boolean {
  return !!KEY;
}

/**
 * The full event schema. A union type rather than free-form strings so a typo is a
 * compile error, not a silently-missing metric that only shows up as a gap in a
 * dashboard weeks later.
 */
export type AnalyticsEvent =
  | "tab_opened"            // which of the 13 stock / 12 macro tabs actually get used
  | "analysis_run"          // the event that maps 1:1 to Anthropic spend
  | "screener_run"          // discovery usage
  | "export_csv"            // Data Explorer / ticker export
  | "alert_created"         // per-ticker alerts
  | "journal_trade_added"   // trade journal engagement
  | "waitlist_submitted"    // Pro-tier intent (Fase 3)
  | "signup_completed"      // funnel endpoint
  | "brief_played"          // el brief hablado se reprodujo (retención)
  // Embudo de pago (Fase 11). Los dos por separado, no un solo "checkout": la diferencia
  // entre ambos ES la métrica — cuántos abren el checkout y cuántos lo terminan. Con un
  // único evento habría que deducir el abandono, que es lo que hay que medir.
  | "checkout_started"      // pulsó Upgrade y se le mandó a Stripe
  | "checkout_completed"    // volvió con el pago hecho
  // El cierre diario. La métrica que importa NO es la visita suelta sino el visitante
  // RECURRENTE (≥3 días/semana): es lo que distingue hábito de curiosidad, y es el único
  // número que dice si /daily está funcionando como producto y no solo como página.
  // Se manda la fecha del informe para poder separar "vino a por el de hoy" de "estaba
  // navegando el archivo", que son dos comportamientos distintos.
  | "daily_viewed"          // abrió un cierre diario
  | "daily_archive_opened"; // saltó a un día anterior desde el navegador de fechas

/** Fire an event. Silently ignored when analytics isn't configured. */
export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!ready) return;
  try {
    posthog.capture(event, props);
  } catch {
    /* analytics must never throw into the caller's path */
  }
}

/** Manual pageview (capture_pageview is off — see initAnalytics). */
export function trackPageview(path: string): void {
  if (!ready) return;
  try {
    posthog.capture("$pageview", { $current_url: path });
  } catch {
    /* ignore */
  }
}

/** Bind subsequent events to a Supabase user id. Never pass an email here. */
export function identify(userId: string): void {
  if (!ready) return;
  try {
    posthog.identify(userId);
  } catch {
    /* ignore */
  }
}

/** Unbind on sign-out so the next visitor isn't attributed to the previous user. */
export function resetIdentity(): void {
  if (!ready) return;
  try {
    posthog.reset();
  } catch {
    /* ignore */
  }
}

/** Initialise once, client-side only. Safe to call repeatedly. */
export function initAnalytics(): void {
  if (ready || !KEY || typeof window === "undefined") return;
  try {
    posthog.init(KEY, {
      api_host: HOST,
      // Explicit events only — see the file header for why.
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      // Don't create person profiles for anonymous visitors: keeps the free-tier
      // person quota for people who actually signed up.
      person_profiles: "identified_only",
      // The app is a PWA; localStorage survives the service-worker lifecycle better
      // than cookies alone.
      persistence: "localStorage+cookie",
    });
    ready = true;
  } catch {
    ready = false;
  }
}
