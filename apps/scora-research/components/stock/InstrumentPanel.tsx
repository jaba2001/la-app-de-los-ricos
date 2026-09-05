"use client";
import type { MacroState } from "@/lib/types";
import type { Instrument } from "@/lib/instrument";
import { stockPickingRegime } from "@/lib/microScore";

interface Props {
  instrument: Instrument;
  closes: number[];      // newest-first (as StockOverview provides)
  spyCloses: number[];
  macro: MacroState | null;
  ticker: string;
}

// ── price helpers (closes are newest-first) ──────────────────────────────────
const ret = (a: number[], d: number) => (a.length > d && a[d] ? ((a[0] - a[d]) / a[d]) * 100 : null);
const mom12_1 = (a: number[]) => (a.length > 252 && a[252] ? ((a[21] - a[252]) / a[252]) * 100 : null);
const smaN = (a: number[], n: number) => (a.length >= n ? a.slice(0, n).reduce((s, x) => s + x, 0) / n : null);
function rsi14(a: number[]): number | null {
  if (a.length < 15) return null;
  let g = 0, l = 0;
  for (let i = 0; i < 14; i++) { const d = a[i] - a[i + 1]; if (d > 0) g += d; else l += -d; }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}

function momScore(m121: number | null, m6: number | null): number {
  let s = 0;
  if (m121 != null) s += m121 > 40 ? 45 : m121 > 20 ? 38 : m121 > 10 ? 30 : m121 > 0 ? 20 : m121 > -15 ? 8 : 0;
  if (m6 != null) s += m6 > 20 ? 25 : m6 > 8 ? 18 : m6 > 0 ? 12 : m6 > -15 ? 5 : 0;
  return Math.round(Math.min(100, (s / 70) * 100));
}

export default function InstrumentPanel({ instrument, closes, spyCloses, macro, ticker }: Props) {
  const m121 = mom12_1(closes), m6 = ret(closes, 126), m3 = ret(closes, 63), m1 = ret(closes, 21);
  const sma200 = smaN(closes, 200), sma50 = smaN(closes, 50);
  const rsi = rsi14(closes);
  const last = closes[0] ?? null;
  const uptrend = last != null && sma200 != null ? last > sma200 : (m121 ?? 0) > 0;
  const above50 = last != null && sma50 != null ? last > sma50 : null;
  const score = momScore(m121, m6);
  const rs6 = (m6 != null && ret(spyCloses, 126) != null) ? m6 - (ret(spyCloses, 126) as number) : null;
  const picking = stockPickingRegime(macro?.implied_corr ?? null);

  // Buy/sell signal — trend + momentum + not-overextended
  const sig = (() => {
    if (m121 == null) return { label: "No data", color: "var(--sr-text-3)", detail: "Not enough price history." };
    if (uptrend && m121 > 0 && (rsi ?? 50) >= 78) return { label: "Extended", color: "var(--sr-warn)", detail: "Uptrend but overbought (RSI high) — wait for a pullback." };
    if (uptrend && m121 > 0) return { label: "Buy · momentum", color: "var(--sr-pos)", detail: "Uptrend + positive 12-1m momentum. In a buy regime." };
    if (!uptrend && m121 < 0) return { label: "Avoid · downtrend", color: "var(--sr-neg)", detail: "Below trend and negative momentum — no edge here." };
    if (uptrend && m121 <= 0) return { label: "Weakening", color: "var(--sr-warn)", detail: "Above trend but momentum fading — watch." };
    return { label: "Neutral", color: "var(--sr-warn)", detail: "Mixed trend/momentum — no clear signal." };
  })();

  const val = (f: string) => { const v = macro ? (macro as unknown as Record<string, unknown>)[f] : null; return typeof v === "number" ? v : null; };

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>{instrument.label} · {instrument.assetClass}</div>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 320, lineHeight: 1.4 }}>{ticker} — momentum & regime read, not fundamentals.</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Signal</div>
          <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: sig.color }}>{sig.label}</div>
        </div>
      </div>
      <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${sig.color} 9%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${sig.color} 26%, transparent)`, fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-3)" }}>{sig.detail}</div>

      {/* Momentum */}
      <div className="sr-flex-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Momentum score</span>
        <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 800, color: score >= 66 ? "var(--sr-pos)" : score >= 40 ? "var(--sr-warn)" : "var(--sr-neg)" }} className="num">{score}/100</span>
      </div>
      <div className="score-bar-track"><div className="score-bar-fill" style={{ width: `${score}%`, background: score >= 66 ? "var(--sr-pos)" : score >= 40 ? "var(--sr-warn)" : "var(--sr-neg)" }} /></div>
      <div style={{ display: "flex", gap: "var(--sr-sp-4)", flexWrap: "wrap", marginTop: "var(--sr-sp-2)", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
        {([["12-1m", m121], ["6m", m6], ["3m", m3], ["1m", m1]] as const).map(([k, v]) => (
          <span key={k}>{k}: <strong className="num" style={{ color: v != null ? (v > 0 ? "var(--sr-pos)" : "var(--sr-neg)") : "var(--sr-text-3)" }}>{v != null ? (v > 0 ? "+" : "") + v.toFixed(0) + "%" : "—"}</strong></span>
        ))}
      </div>

      {/* Technicals + relative strength */}
      <div style={{ display: "flex", gap: "var(--sr-sp-4)", flexWrap: "wrap", marginTop: "var(--sr-sp-3)", paddingTop: "var(--sr-sp-3)", borderTop: "1px solid var(--sr-border)", fontSize: "var(--sr-t-xs)" }}>
        <span style={{ color: "var(--sr-text-3)" }}>Trend: <strong style={{ color: uptrend ? "var(--sr-pos)" : "var(--sr-neg)" }}>{uptrend ? "Up" : "Down"}</strong> <span style={{ color: "var(--sr-text-3)" }}>(vs 200-day{above50 != null ? `, ${above50 ? ">" : "<"}50-day` : ""})</span></span>
        <span style={{ color: "var(--sr-text-3)" }}>RSI: <strong className="num" style={{ color: rsi == null ? "var(--sr-text-3)" : rsi >= 70 ? "var(--sr-neg)" : rsi <= 30 ? "var(--sr-pos)" : "var(--sr-text-2)" }}>{rsi != null ? rsi.toFixed(0) : "—"}</strong></span>
        <span style={{ color: "var(--sr-text-3)" }}>RS vs SPY (6m): <strong className="num" style={{ color: rs6 == null ? "var(--sr-text-3)" : rs6 > 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>{rs6 != null ? (rs6 > 0 ? "+" : "") + rs6.toFixed(0) + "pp" : "—"}</strong></span>
      </div>

      {/* Macro drivers */}
      {instrument.drivers.length > 0 && (
        <div style={{ marginTop: "var(--sr-sp-3)", paddingTop: "var(--sr-sp-3)", borderTop: "1px solid var(--sr-border)" }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Macro drivers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {instrument.drivers.map((d) => {
              const v = val(d.field);
              return (
                <div key={d.field} className="sr-flex-between" style={{ fontSize: "var(--sr-t-xs)" }}>
                  <span style={{ color: "var(--sr-text-2)" }}>{d.label}</span>
                  <span className="num" style={{ color: "var(--sr-text)", fontWeight: 600 }}>
                    {v != null ? v.toFixed(d.field === "hy_oas" || d.field === "bbb_oas" || d.field === "dxy" ? 0 : 1) + (d.unit ?? "") : "—"}
                    <span style={{ fontSize: "9px", color: "var(--sr-text-3)", marginLeft: 5 }}>favorable si {d.good === "low" ? "↓" : "↑"}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginTop: "var(--sr-sp-3)", fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
        {instrument.note} Selection regime: <strong style={{ color: picking.color }}>{picking.label.toLowerCase()}</strong> (momentum pays when correlation is low). Educational — not advice.
      </div>
    </div>
  );
}
