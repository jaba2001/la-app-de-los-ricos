"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ALLOCATOR_BACKTEST as A, STOCK_PICKING as M } from "@/lib/trackRecord";

export default function Landing() {
  const { session, loading } = useAuth();
  const router = useRouter();

  // Logged-in visitors go straight to the app; the landing is for everyone else.
  useEffect(() => { if (!loading && session) router.replace("/macro"); }, [session, loading, router]);
  if (session) return null;

  const go = () => router.push("/login");
  const card = { background: "var(--sr-surface)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius-lg, 14px)", padding: "var(--sr-sp-5)" } as const;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "var(--sr-sp-4) var(--sr-sp-6) var(--sr-sp-6)" }}>
      {/* Minimal top bar (the app Nav is hidden when logged out) */}
      <div className="sr-flex-between" style={{ padding: "var(--sr-sp-2) 0 var(--sr-sp-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "var(--sr-amber)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 12L6 7L9 10L13 4" stroke="#070E1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="13" cy="4" r="1.5" fill="#070E1A" /></svg>
          </div>
          <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }}>Scora <span style={{ fontWeight: 400, color: "var(--sr-text-3)" }}>Research</span></span>
        </div>
        <div style={{ display: "flex", gap: "var(--sr-sp-3)", alignItems: "center" }}>
          <a onClick={() => router.push("/pricing")} style={{ cursor: "pointer", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>Pricing</a>
          <button onClick={go} style={{ background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text)", fontSize: "var(--sr-t-sm)", fontWeight: 600, padding: "6px 14px", cursor: "pointer" }}>Sign in</button>
        </div>
      </div>

      {/* Hero */}
      <section style={{ padding: "clamp(32px,7vw,80px) 0 clamp(24px,4vw,44px)", textAlign: "center", maxWidth: 780, marginInline: "auto" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--sr-amber) 35%, transparent)", background: "color-mix(in srgb, var(--sr-amber) 8%, transparent)", fontSize: "var(--sr-t-xs)", color: "var(--sr-amber)", fontWeight: 600, marginBottom: "var(--sr-sp-4)" }}>
          Free · macro + micro research
        </div>
        <h1 style={{ fontSize: "clamp(30px,6vw,54px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.08, margin: 0, textWrap: "balance" }}>
          The top-down system that <span style={{ color: "var(--sr-amber)" }}>corrects itself</span>.
        </h1>
        <p style={{ fontSize: "clamp(16px,2.4vw,20px)", color: "var(--sr-text-2)", lineHeight: 1.6, margin: "var(--sr-sp-4) auto 0", maxWidth: 620 }}>
          Regime-driven multi-asset allocation, <strong style={{ color: "var(--sr-text)" }}>validated out-of-sample</strong> — plus an AI layer that <strong style={{ color: "var(--sr-text)" }}>can&apos;t invent a number</strong>, enforced in code. Not a &ldquo;+8% in 30 days&rdquo; pitch. Risk, managed and auditable.
        </p>
        <div style={{ display: "flex", gap: "var(--sr-sp-3)", justifyContent: "center", marginTop: "var(--sr-sp-5)", flexWrap: "wrap" }}>
          <button onClick={go} style={{ background: "var(--sr-amber)", color: "#0a1120", border: "none", borderRadius: "var(--sr-radius)", padding: "12px 28px", fontSize: "var(--sr-t-base)", fontWeight: 700, cursor: "pointer" }}>Start free →</button>
          <button onClick={() => router.push("/track-record")} style={{ background: "var(--sr-surface-2)", color: "var(--sr-text)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", padding: "12px 24px", fontSize: "var(--sr-t-base)", fontWeight: 600, cursor: "pointer" }}>See the evidence</button>
        </div>
      </section>

      {/* Validated numbers */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-6)" }}>
        {[
          { k: "Allocator Sharpe", v: A.strategy.sharpe.toFixed(2), s: `SPY ${A.spy.sharpe.toFixed(2)}` },
          { k: "Max drawdown", v: `${A.strategy.maxDrawdown}%`, s: `SPY ${A.spy.maxDrawdown}%` },
          { k: "Walk-forward OOS", v: A.walkForward.oosSharpe.toFixed(2), s: `${A.walkForward.oosMonths}m, gap ~${A.walkForward.overfitGap}` },
          { k: "Tested through", v: `${A.months}m`, s: A.period },
        ].map((s) => (
          <div key={s.k} style={{ ...card, textAlign: "center", padding: "var(--sr-sp-4)" }}>
            <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.k}</div>
            <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: "var(--sr-pos)", margin: "4px 0 2px" }} className="num">{s.v}</div>
            <div style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{s.s}</div>
          </div>
        ))}
      </section>

      {/* Three pillars */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--sr-sp-4)", marginBottom: "var(--sr-sp-6)" }}>
        {[
          { t: "The edge is allocation", d: `We measured it honestly: picking value/quality stocks doesn't beat SPY (IC ${M.valueQuality.ic.toFixed(3)} on ${M.universe} names). Regime-driven multi-asset allocation does — risk-adjusted, with a fraction of the drawdown.`, tag: "validated OOS" },
          { t: "AI that can't hallucinate", d: "Every AI answer is checked against the data it was given, in code — not just in the prompt. Fabricated figures are flagged and logged. A weaker, free model stays safe because governance doesn't depend on the model.", tag: "code-enforced gate" },
          { t: "A self-correcting top-down loop", d: "Secular clock → risk-on allocation → sector rotation → selection, with a breadth loop that flags when the macro read and the market's participation diverge — an early warning, not a forecast.", tag: "macro ↔ micro" },
        ].map((p) => (
          <div key={p.t} style={card}>
            <div style={{ fontSize: "9px", fontWeight: 700, color: "var(--sr-amber)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{p.tag}</div>
            <h3 style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.01em" }}>{p.t}</h3>
            <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.6, margin: 0 }}>{p.d}</p>
          </div>
        ))}
      </section>

      {/* Honest positioning */}
      <section style={{ ...card, background: "color-mix(in srgb, var(--sr-amber) 6%, var(--sr-surface))", borderColor: "color-mix(in srgb, var(--sr-amber) 26%, transparent)", textAlign: "center", marginBottom: "var(--sr-sp-6)" }}>
        <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, lineHeight: 1.5, maxWidth: 680, marginInline: "auto" }}>
          Everything is <span style={{ color: "var(--sr-amber)" }}>measured, not asserted</span> — the backtest is survivorship-free and out-of-sample, the AI cites only real numbers, and a live autonomous paper fund runs the strategy in the open.
        </div>
        <div style={{ display: "flex", gap: "var(--sr-sp-4)", justifyContent: "center", marginTop: "var(--sr-sp-4)", flexWrap: "wrap" }}>
          <a onClick={() => router.push("/track-record")} style={{ cursor: "pointer", color: "var(--sr-amber)", fontWeight: 600, fontSize: "var(--sr-t-sm)" }}>→ Live track record</a>
          <a onClick={() => router.push("/audit")} style={{ cursor: "pointer", color: "var(--sr-amber)", fontWeight: 600, fontSize: "var(--sr-t-sm)" }}>→ AI audit trail</a>
          <a onClick={() => router.push("/pricing")} style={{ cursor: "pointer", color: "var(--sr-amber)", fontWeight: 600, fontSize: "var(--sr-t-sm)" }}>→ Pricing</a>
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ textAlign: "center", padding: "var(--sr-sp-5) 0 var(--sr-sp-6)" }}>
        <h2 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 var(--sr-sp-3)" }}>See the regime for yourself.</h2>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", margin: "0 0 var(--sr-sp-4)" }}>Free to start. The whole engine runs on free data.</p>
        <button onClick={go} style={{ background: "var(--sr-amber)", color: "#0a1120", border: "none", borderRadius: "var(--sr-radius)", padding: "12px 32px", fontSize: "var(--sr-t-base)", fontWeight: 700, cursor: "pointer" }}>Start free →</button>
      </section>
    </div>
  );
}
