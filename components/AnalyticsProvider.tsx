"use client";
// Mounts PostHog and keeps identity + pageviews in sync with the app.
//
// Renders nothing. Must sit inside AuthProvider (it reads the session) — see
// app/layout.tsx. Everything degrades to a no-op when NEXT_PUBLIC_POSTHOG_KEY
// is unset, so this component is safe to ship before the key exists.
//
// Pageviews are keyed off usePathname() only, deliberately: useSearchParams()
// would force a Suspense boundary around the whole tree in Next 15, and no route
// in Scora carries meaningful query state (ticker is a path segment).
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { initAnalytics, identify, resetIdentity, trackPageview, track } from "@/lib/analytics";

export default function AnalyticsProvider() {
  const { session, loading } = useAuth();
  const pathname = usePathname();
  // Tracks the last identified user so we only fire identify/reset on real
  // transitions, not on every token refresh (Supabase refreshes on an interval).
  const identified = useRef<string | null>(null);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (pathname) trackPageview(pathname);
  }, [pathname]);

  useEffect(() => {
    if (loading) return;
    const uid = session?.user?.id ?? null;
    if (uid && identified.current !== uid) {
      identify(uid);
      // First time we ever see this user id in this browser → treat as signup
      // completion. Magic-link login means there's no separate signup callback
      // to hook, so this is the closest honest signal for the funnel endpoint.
      if (typeof window !== "undefined") {
        const seenKey = `sr_seen_${uid}`;
        if (!window.localStorage.getItem(seenKey)) {
          window.localStorage.setItem(seenKey, "1");
          track("signup_completed");
        }
      }
      identified.current = uid;
    } else if (!uid && identified.current) {
      resetIdentity();
      identified.current = null;
    }
  }, [session, loading]);

  return null;
}
