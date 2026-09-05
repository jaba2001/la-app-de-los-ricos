"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// First-run welcome (B2). Dismissible, remembered in localStorage — no server round-trip.
// Points a new user at the one thing that matters: the regime read drives everything below.
const KEY = "scora_welcomed_v1";

export default function WelcomeBanner() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => { try { setShow(localStorage.getItem(KEY) !== "1"); } catch { /* SSR / privacy mode */ } }, []);
  if (!show) return null;

  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setShow(false); };

  return (
    <div style={{ marginBottom: "var(--sr-sp-4)", padding: "var(--sr-sp-4)", borderRadius: "var(--sr-radius-lg, 14px)", background: "color-mix(in srgb, var(--sr-amber) 7%, var(--sr-surface-2))", border: "1px solid color-mix(in srgb, var(--sr-amber) 26%, transparent)" }}>
      <div className="sr-flex-between" style={{ alignItems: "flex-start", gap: "var(--sr-sp-3)" }}>
        <div>
          <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }}>Welcome to Scora 👋</div>
          <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 4, maxWidth: 640, lineHeight: 1.55 }}>
            Read it top-down: the <strong style={{ color: "var(--sr-text)" }}>regime</strong> here sets everything. In three steps —
          </div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" style={{ background: "none", border: "none", color: "var(--sr-text-3)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
      </div>
      <ol style={{ margin: "var(--sr-sp-3) 0 0", paddingLeft: 18, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
        <li>Check the <strong>risk-on gauge</strong> &amp; the top-down↔bottom-up loop in the Regime Radar (Portfolio tab).</li>
        <li>Search any ticker up top — stocks, bonds, metals, ETFs all get the right analysis.</li>
        <li>See the <a onClick={() => router.push("/track-record")} style={{ cursor: "pointer" }}>evidence</a> and the <a onClick={() => router.push("/audit")} style={{ cursor: "pointer" }}>AI audit trail</a> — everything is measured, not asserted.</li>
      </ol>
      <button onClick={dismiss} style={{ marginTop: "var(--sr-sp-3)", background: "var(--sr-amber)", color: "#0a1120", border: "none", borderRadius: "var(--sr-radius)", padding: "7px 18px", fontSize: "var(--sr-t-xs)", fontWeight: 700, cursor: "pointer" }}>Got it</button>
    </div>
  );
}
