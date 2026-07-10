"use client";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

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
            <button onClick={go} style={{
              width: "100%", marginTop: "var(--sr-sp-5)", borderRadius: "var(--sr-radius)", padding: "10px 0", fontSize: "var(--sr-t-sm)", fontWeight: 700, cursor: "pointer",
              background: t.highlight ? "var(--sr-amber)" : "var(--sr-surface-2)", color: t.highlight ? "#0a1120" : "var(--sr-text)",
              border: t.highlight ? "none" : "1px solid var(--sr-border)",
            }}>{t.cta}</button>
          </div>
        ))}
      </div>

      <p style={{ fontSize: "10px", color: "var(--sr-text-3)", textAlign: "center", marginTop: "var(--sr-sp-5)", lineHeight: 1.6, maxWidth: 620, marginInline: "auto" }}>
        * No monthly cost to you. If a paid tier launches, any processor fee applies only to what you actually earn — never a fixed charge. Educational tool, not investment advice.
      </p>
    </div>
  );
}
