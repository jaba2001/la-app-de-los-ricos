"use client";
import { useState } from "react";
import { equalWeightPlan, kelly, MAX_POSITION } from "@/lib/kelly";

function money(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function PositionSizer() {
  const [portfolio, setPortfolio] = useState("100000");
  const [fullCount, setFullCount] = useState("10");
  const [halfCount, setHalfCount] = useState("0");
  // Kelly inputs (optional edge estimate)
  const [winProb, setWinProb] = useState("55");
  const [upside, setUpside] = useState("30");
  const [downside, setDownside] = useState("15");

  const pv = Number(portfolio);
  const plan = equalWeightPlan(pv, Number(fullCount), Number(halfCount));
  const k = kelly(Number(winProb) / 100, Number(upside), Number(downside));

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px", background: "var(--sr-surface)", border: "1px solid var(--sr-border)",
    borderRadius: "var(--sr-radius)", color: "var(--sr-text)", fontSize: "var(--sr-t-sm)", outline: "none", fontFamily: "inherit", width: 90,
  };
  const lbl: React.CSSProperties = { fontSize: "10px", color: "var(--sr-text-3)", display: "block", marginBottom: 3 };

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div className="section-label">Position sizing</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 560, lineHeight: 1.5 }}>
        Equal-weight core positions with half-size slots for higher-risk small caps — plus Kelly if you have an edge estimate. A calculator, not advice.
      </div>

      {/* Equal-weight */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", alignItems: "flex-end", marginBottom: "var(--sr-sp-3)" }}>
        <label><span style={lbl}>Portfolio $</span><input style={inputStyle} type="number" value={portfolio} onChange={e => setPortfolio(e.target.value)} /></label>
        <label><span style={lbl}>Core names</span><input style={inputStyle} type="number" value={fullCount} onChange={e => setFullCount(e.target.value)} /></label>
        <label><span style={lbl}>Half-size (small cap)</span><input style={inputStyle} type="number" value={halfCount} onChange={e => setHalfCount(e.target.value)} /></label>
      </div>

      {plan ? (
        <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-tile">
            <div className="sr-tile-label">Full position</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: plan.exceedsCap ? "var(--sr-warn)" : "var(--sr-text)" }} className="num">{(plan.fullWeight * 100).toFixed(1)}%</div>
            <div className="sr-hint">{money(plan.fullDollars)} each</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">Half position</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{(plan.halfWeight * 100).toFixed(1)}%</div>
            <div className="sr-hint">{money(plan.halfDollars)} each</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">If one falls 20%</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: "var(--sr-neg)" }} className="num">−{plan.drawdownImpact20}%</div>
            <div className="sr-hint">portfolio impact</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">Cap check</div>
            <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: plan.exceedsCap ? "var(--sr-warn)" : "var(--sr-pos)" }}>{plan.exceedsCap ? "Over cap" : "OK"}</div>
            <div className="sr-hint">{(MAX_POSITION * 100).toFixed(0)}% max/name</div>
          </div>
        </div>
      ) : (
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-4)" }}>Enter a portfolio value and at least one position.</div>
      )}

      {/* Kelly */}
      <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)" }}>
        <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>Kelly (optional edge estimate)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", alignItems: "flex-end", marginBottom: "var(--sr-sp-2)" }}>
          <label><span style={lbl}>Win prob %</span><input style={inputStyle} type="number" value={winProb} onChange={e => setWinProb(e.target.value)} /></label>
          <label><span style={lbl}>Upside %</span><input style={inputStyle} type="number" value={upside} onChange={e => setUpside(e.target.value)} /></label>
          <label><span style={lbl}>Downside %</span><input style={inputStyle} type="number" value={downside} onChange={e => setDownside(e.target.value)} /></label>
        </div>
        {k ? (
          k.favorable ? (
            <div className="sr-hint" style={{ lineHeight: 1.6 }}>
              Payoff ratio <strong>{k.b}</strong> · full-Kelly <strong>{(k.full * 100).toFixed(1)}%</strong> · half-Kelly <strong>{(k.half * 100).toFixed(1)}%</strong> · capped <strong style={{ color: "var(--sr-amber)" }}>{(k.capped * 100).toFixed(1)}%</strong>. Practitioners bet a fraction of full-Kelly.
            </div>
          ) : (
            <div className="sr-hint" style={{ color: "var(--sr-neg)" }}>No positive edge at these inputs → Kelly says don&apos;t bet.</div>
          )
        ) : <div className="sr-hint">Enter win probability, upside and downside.</div>}
      </div>
    </div>
  );
}
