"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { track } from "@/lib/analytics";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "https://ic-proxy-psi.vercel.app";

const TIERS = [
  {
    name: "Free", price: "€0", tagline: "The whole engine, forever.",
    highlight: false,
    features: [
      "Macro regime + validated allocator",
      "Live track record & AI audit trail",
      "Stock, bond & instrument analysis",
      "1 full deep-dive analysis / day",
      "Discovery screener (stocks + cross-asset)",
    ],
    cta: "Start free",
  },
  {
    name: "Pro", price: "€0*", tagline: "For heavy users — when it exists.",
    highlight: true,
    features: [
      "Everything in Free",
      "Unlimited AI thesis, reports & due-diligence",
      "Regime-change & divergence alerts",
      "Watchlist signal notifications",
      "HTML research-note export",
    ],
    cta: "Notify me",
  },
];

/**
 * Pro-tier waitlist. Replaces a "Notify me" button that called router.push("/macro") and
 * recorded nothing — the one place in the product where someone declares intent to pay.
 * The count in sl_waitlist is the signal that decides whether Pro (and Stripe) is worth
 * building at all, so it has to be captured before that decision, not after.
 */
function WaitlistForm({ defaultEmail, accessToken }: { defaultEmail: string; accessToken: string | null }) {
  const [email, setEmail] = useState(defaultEmail);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending"); setError("");
    try {
      // Send the session token rather than a user id in the body: the proxy attributes the
      // row from the VERIFIED token (lib/auth.js optionalUser) and ignores any client-
      // supplied id, since that would be an unauthenticated claim of identity. Logged-out
      // visitors simply send no token and land with a null user_id, which is the point.
      const res = await fetch(`${PROXY}/api/waitlist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          email,
          tier: "pro",
          source: "pricing",
          referrer: typeof document !== "undefined" ? document.referrer.slice(0, 200) : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setState("error"); setError(body?.error || "Something went wrong. Try again."); return; }
      track("waitlist_submitted");
      setState("done");
    } catch {
      setState("error");
      setError("Network error. Try again in a moment.");
    }
  }

  if (state === "done") {
    return (
      <div style={{ marginTop: "var(--sr-sp-5)", fontSize: "var(--sr-t-sm)", color: "var(--sr-pos)", lineHeight: 1.5 }}>
        ✓ You&apos;re on the list. We&apos;ll email you once — when there&apos;s something real to try.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "var(--sr-sp-5)", display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" aria-label="Email for the Pro waitlist"
        style={{
          width: "100%", borderRadius: "var(--sr-radius)", padding: "9px 12px",
          fontSize: "var(--sr-t-sm)", background: "var(--sr-surface-2)",
          border: "1px solid var(--sr-border)", color: "var(--sr-text)",
        }}
      />
      <button
        type="submit" disabled={state === "sending"}
        style={{
          width: "100%", borderRadius: "var(--sr-radius)", padding: "10px 0",
          fontSize: "var(--sr-t-sm)", fontWeight: 700,
          cursor: state === "sending" ? "default" : "pointer",
          background: "var(--sr-amber)", color: "#0a1120", border: "none",
          opacity: state === "sending" ? 0.6 : 1,
        }}
      >
        {state === "sending" ? "Adding…" : "Notify me"}
      </button>
      {error && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-neg)", lineHeight: 1.4 }}>{error}</div>}
      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
        One email when Pro launches. No newsletter, no sharing.
      </div>
    </form>
  );
}

export default function Pricing() {
  const { session } = useAuth();
  const router = useRouter();
  const go = () => router.push(session ? "/macro" : "/login");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "var(--sr-sp-6)" }}>
      <div style={{ textAlign: "center", marginBottom: "var(--sr-sp-6)" }}>
        <h1 style={{ fontSize: "var(--sr-t-3xl, 34px)", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>Pricing</h1>
        <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-2)", marginTop: "var(--sr-sp-3)", maxWidth: 560, marginInline: "auto", lineHeight: 1.6 }}>
          The engine runs entirely on free data, so the core is <strong style={{ color: "var(--sr-text)" }}>free forever</strong>. A Pro tier will only add convenience (higher limits, alerts) — never the analysis itself.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--sr-sp-4)" }}>
        {TIERS.map((t) => (
          <div key={t.name} style={{
            background: "var(--sr-surface)", borderRadius: 16, padding: "var(--sr-sp-5)",
            border: t.highlight ? "1.5px solid color-mix(in srgb, var(--sr-amber) 55%, transparent)" : "1px solid var(--sr-border)",
            boxShadow: t.highlight ? "0 0 0 4px color-mix(in srgb, var(--sr-amber) 8%, transparent)" : "none",
          }}>
            <div className="sr-flex-between" style={{ alignItems: "baseline" }}>
              <span style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800 }}>{t.name}</span>
              <span style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: "var(--sr-amber)" }} className="num">{t.price}</span>
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, marginBottom: "var(--sr-sp-4)" }}>{t.tagline}</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
              {t.features.map((f) => (
                <li key={f} style={{ display: "flex", gap: 8, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.4 }}>
                  <span style={{ color: "var(--sr-pos)", flexShrink: 0 }}>✓</span>{f}
                </li>
              ))}
            </ul>
            {/* Free tier keeps the straight CTA into the app. Pro captures the email —
                it's the only intent-to-pay signal the product ever gets. */}
            {t.name === "Pro" ? (
              <WaitlistForm defaultEmail={session?.user?.email ?? ""} accessToken={session?.access_token ?? null} />
            ) : (
              <button onClick={go} style={{
                width: "100%", marginTop: "var(--sr-sp-5)", borderRadius: "var(--sr-radius)", padding: "10px 0", fontSize: "var(--sr-t-sm)", fontWeight: 700, cursor: "pointer",
                background: t.highlight ? "var(--sr-amber)" : "var(--sr-surface-2)", color: t.highlight ? "#0a1120" : "var(--sr-text)",
                border: t.highlight ? "none" : "1px solid var(--sr-border)",
              }}>{t.cta}</button>
            )}
          </div>
        ))}
      </div>

      <p style={{ fontSize: "10px", color: "var(--sr-text-3)", textAlign: "center", marginTop: "var(--sr-sp-5)", lineHeight: 1.6, maxWidth: 620, marginInline: "auto" }}>
        * No monthly cost to you. If a paid tier launches, any processor fee applies only to what you actually earn — never a fixed charge. Educational tool, not investment advice.
      </p>
    </div>
  );
}
