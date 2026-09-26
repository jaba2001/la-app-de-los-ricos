"use client";
// Public, read-only demo (F4.1) — the conversion bridge between the landing's claims and
// the logged-in app. Renders the LIVE regime read (macro_state is shared, non-user data,
// publicly readable) through the exact validated libs the app uses: risk-on gauge →
// breadth confirmation loop → target allocation blend → secular baseline. No auth, no
// writes, no per-user data. If the row can't be read (offline / policy change) it
// degrades to the static validated numbers + CTA instead of breaking.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { datos } from "@/lib/dataClient";
import { regimeConfirmation } from "@/lib/regimeLoop";
import { buildAllocation, computeRiskOn, ALLOC_ASSETS, ASSET_META } from "@/lib/allocation";
import { secularRegime } from "@/lib/secular";
import { stockPickingRegime } from "@/lib/microScore";
import { GROWTH_BACKTEST as A } from "@/lib/trackRecord";
import type { MacroState } from "@/lib/types";
import PaperFund from "@/components/macro/PaperFund";

const card = { background: "var(--sr-surface)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius-lg, 14px)", padding: "var(--sr-sp-5)" } as const;
const label = { fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" } as const;

export default function Demo() {
  const router = useRouter();
  const [macro, setMacro] = useState<MacroState | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    datos.from("macro_state").select("*").eq("id", 1).single()
      .then(({ data }) => { setMacro((data as MacroState) ?? null); setLoaded(true); });
  }, []);

  const riskOn = macro?.risk_on != null ? Number(macro.risk_on)
    : macro ? computeRiskOn({ lcc: macro.liquidity_cycle ?? null, rpc: macro.recession_prob ?? null, csc: macro.credit_stress ?? null }) : null;
  const conf = regimeConfirmation(riskOn, macro?.breadth_200dma ?? null);
  const alloc = riskOn != null ? buildAllocation({ riskOn }) : null;
  const sec = secularRegime(macro?.buffett_indicator ?? null, macro?.cape ?? null, macro?.expected_return_10y ?? null);
  const pick = stockPickingRegime(macro?.implied_corr != null ? Number(macro.implied_corr) : null);
  const n = (v: unknown, d = 0) => (v == null || isNaN(Number(v)) ? "—" : Number(v).toFixed(d));

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "var(--sr-sp-4) var(--sr-sp-6) var(--sr-sp-6)" }}>
      {/* Top bar */}
      <div className="sr-flex-between" style={{ padding: "var(--sr-sp-2) 0 var(--sr-sp-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => router.push("/")}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "var(--sr-amber)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 12L6 7L9 10L13 4" stroke="#070E1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="13" cy="4" r="1.5" fill="#070E1A" /></svg>
          </div>
          <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }}>Scora <span style={{ fontWeight: 400, color: "var(--sr-text-3)" }}>Research</span></span>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--sr-amber)", padding: "2px 8px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--sr-amber) 35%, transparent)", background: "color-mix(in srgb, var(--sr-amber) 8%, transparent)" }}>LIVE DEMO · READ-ONLY</span>
        </div>
        <button onClick={() => router.push("/login")} style={{ background: "var(--sr-amber)", color: "#0a1120", border: "none", borderRadius: "var(--sr-radius)", padding: "8px 18px", fontSize: "var(--sr-t-sm)", fontWeight: 700, cursor: "pointer" }}>Start free →</button>
      </div>

      <h1 style={{ fontSize: "clamp(22px,4vw,32px)", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 var(--sr-sp-2)" }}>Today&apos;s regime, straight from the engine.</h1>
      <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", margin: "0 0 var(--sr-sp-5)", maxWidth: 640, lineHeight: 1.6 }}>
        This is the live read the app runs on — the same gauge, the same breadth loop, the same validated allocator. Read-only; the full app adds stock scoring, grounded AI, alerts and the audit trail.
      </p>

      {!loaded ? (
        <div style={{ ...card, textAlign: "center", color: "var(--sr-text-3)" }}>Loading the live regime…</div>
      ) : !macro ? (
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-3)" }}>The live read isn&apos;t available right now — the validated results below still stand.</div>
        </div>
      ) : (
        <>
          {/* Gauge + loop */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--sr-sp-4)", marginBottom: "var(--sr-sp-4)" }}>
            <div style={card}>
              <div style={label}>Risk-on gauge · liquidity-led</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "6px 0 4px" }}>
                <span className="num" style={{ fontSize: "var(--sr-t-3xl)", fontWeight: 800, color: riskOn != null ? (riskOn >= 60 ? "var(--sr-pos)" : riskOn >= 40 ? "var(--sr-warn)" : "var(--sr-neg)") : "var(--sr-text-3)" }}>{n(riskOn)}</span>
                <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", fontWeight: 600 }}>{riskOn == null ? "" : riskOn >= 60 ? "Risk-on" : riskOn >= 40 ? "Neutral" : "Risk-off"}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "var(--sr-surface-3)", overflow: "hidden", marginBottom: 8 }}>
                <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, riskOn ?? 0))}%`, background: "linear-gradient(90deg, var(--sr-neg), var(--sr-warn), var(--sr-pos))" }} />
              </div>
              <div className="sr-hint">Drivers (0-100): liquidity {n(macro.risk_on_lcc)} · recession risk {n(macro.risk_on_rpc)} · financial stress {n(macro.risk_on_csc)} · as of {macro.snapshot_date ?? "—"}</div>
            </div>
            <div style={{ ...card, borderColor: `color-mix(in srgb, ${conf.color} 30%, var(--sr-border))` }}>
              <div style={label}>The loop · top-down vs breadth</div>
              <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: conf.color, margin: "6px 0 4px" }}>{conf.label}</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.55 }}>{conf.detail}</div>
            </div>
          </section>

          {/* Breadth tiles */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
            {[
              ["Above 200-day", macro.breadth_200dma, "% of the S&P 500"],
              ["Above 50-day", macro.breadth_50dma, "shorter-term participation"],
              ["Positive 12-1m momentum", macro.breadth_mom, "% of names"],
              ["Up over 1 month", macro.breadth_1m, "near-term thrust"],
            ].map(([k, v, s]) => (
              <div key={k as string} style={{ ...card, padding: "var(--sr-sp-4)", textAlign: "center" }}>
                <div style={label}>{k as string}</div>
                <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, margin: "4px 0 2px" }}>{v != null ? `${Number(v).toFixed(1)}%` : "—"}</div>
                <div className="sr-hint">{s as string}</div>
              </div>
            ))}
          </section>

          {/* Target allocation */}
          {alloc && (
            <section style={{ ...card, marginBottom: "var(--sr-sp-4)" }}>
              <div className="sr-flex-between" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <div style={label}>Target allocation · Growth mandate (pre-trend-gate)</div>
                <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: alloc.tiltColor }}>{alloc.tiltLabel}</span>
              </div>
              <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", border: "1px solid var(--sr-border)", marginBottom: 6 }}>
                {ALLOC_ASSETS.map((a) => {
                  const w = alloc.weights[a] || 0;
                  if (w <= 0) return null;
                  return <div key={a} title={`${a} ${(w * 100).toFixed(0)}%`} style={{ width: `${w * 100}%`, background: ASSET_META[a].color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>{w >= 0.08 ? (w * 100).toFixed(0) : ""}</div>;
                })}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", marginBottom: 8 }}>
                {ALLOC_ASSETS.map((a) => (
                  <span key={a} className="sr-hint" style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: ASSET_META[a].color, display: "inline-block" }} />{a} {((alloc.weights[a] || 0) * 100).toFixed(0)}%</span>
                ))}
              </div>
              <div className="sr-hint">The logged-in app adds the 12-1m trend gate on top, plus a Defensive profile (risk-parity, −7.5% max drawdown) for conservative mandates.</div>
            </section>
          )}

          {/* Layers strip */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)" }}>
            <div style={card}>
              <div style={label}>L1 · Secular</div>
              <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, margin: "5px 0 3px" }}>{sec.phase} · baseline {sec.baselineEquity}% equity</div>
              <div className="sr-hint">Buffett {n(macro.buffett_indicator)}% · CAPE {n(macro.cape, 1)} — the long cycle sets the ceiling the tactical layers tilt around.</div>
            </div>
            <div style={card}>
              <div style={label}>L4 · Stock selection regime</div>
              <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, margin: "5px 0 3px", color: pick.color }}>{pick.label}</div>
              <div className="sr-hint">Implied correlation {n(macro.implied_corr, 1)} — {pick.detail}</div>
            </div>
          </section>
        </>
      )}

      {/* The living proof — the autonomous paper fund, read-only (anon SELECT policy) */}
      <PaperFund />

      {/* Validated numbers + CTA */}
      <section style={{ ...card, background: "color-mix(in srgb, var(--sr-amber) 6%, var(--sr-surface))", borderColor: "color-mix(in srgb, var(--sr-amber) 26%, transparent)", textAlign: "center" }}>
        <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, marginBottom: 6 }}>
          The Growth mandate behind this read, vs the S&amp;P 500 ({A.months} months, net of costs): Sharpe {A.strategy.sharpe.toFixed(2)} vs {A.spy.sharpe.toFixed(2)} · Sortino {A.strategy.sortino.toFixed(2)} vs {A.spy.sortino.toFixed(2)} · max drawdown {A.strategy.maxDrawdown}% vs {A.spy.maxDrawdown}% · Jensen α +{A.strategy.alpha}%/yr. <span style={{ color: "var(--sr-text-3)", fontWeight: 400 }}>The index returned more in raw terms (+{A.spy.totalReturn.toFixed(0)}% vs +{A.strategy.totalReturn.toFixed(0)}%) at 2.9× the drawdown — we show it openly. On the risk-adjusted scorecard, Growth beats it. (For context: ~90% of active US large-cap funds trail the S&amp;P 500 over 15 years on raw return — SPIVA U.S. Scorecard.)</span>
        </div>
        <div style={{ display: "flex", gap: "var(--sr-sp-3)", justifyContent: "center", marginTop: "var(--sr-sp-3)", flexWrap: "wrap" }}>
          <button onClick={() => router.push("/login")} style={{ background: "var(--sr-amber)", color: "#0a1120", border: "none", borderRadius: "var(--sr-radius)", padding: "10px 26px", fontSize: "var(--sr-t-sm)", fontWeight: 700, cursor: "pointer" }}>Start free →</button>
          <button onClick={() => router.push("/track-record")} style={{ background: "var(--sr-surface-2)", color: "var(--sr-text)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", padding: "10px 20px", fontSize: "var(--sr-t-sm)", fontWeight: 600, cursor: "pointer" }}>See the evidence</button>
        </div>
      </section>

      <p className="sr-hint" style={{ textAlign: "center", marginTop: "var(--sr-sp-4)", lineHeight: 1.6 }}>
        Educational analysis, not investment advice. ETF examples, not recommendations. Data: FRED, Yahoo Finance, SEC EDGAR — free sources end to end.
      </p>
    </div>
  );
}
