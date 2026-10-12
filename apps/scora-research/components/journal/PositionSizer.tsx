"use client";
import { useState } from "react";
import { equalWeightPlan, kelly, MAX_POSITION } from "@/lib/kelly";
import { t } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

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
      <div className="section-label">{t("Position sizing")}</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 560, lineHeight: 1.5 }}>
        {t("Equal-weight core positions with half-size slots for higher-risk small caps — plus Kelly if you have an edge estimate. A calculator, not advice.")}</div>

      {/* Equal-weight */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", alignItems: "flex-end", marginBottom: "var(--sr-sp-3)" }}>
        <label><span style={lbl}>{t("Portfolio $")}</span><input style={inputStyle} type="number" value={portfolio} onChange={e => setPortfolio(e.target.value)} /></label>
        <label><span style={lbl}>{t("Core names")}</span><input style={inputStyle} type="number" value={fullCount} onChange={e => setFullCount(e.target.value)} /></label>
        <label><span style={lbl}>{t("Half-size (small cap)")}</span><input style={inputStyle} type="number" value={halfCount} onChange={e => setHalfCount(e.target.value)} /></label>
      </div>

      {plan ? (
        <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-tile">
            <div className="sr-tile-label">{t("Full position")}</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: plan.exceedsCap ? "var(--sr-warn)" : "var(--sr-text)" }} className="num">{(plan.fullWeight * 100).toFixed(1)}%</div>
            <div className="sr-hint">{t(`${money(plan.fullDollars)} each`)}</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">{t("Half position")}</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{(plan.halfWeight * 100).toFixed(1)}%</div>
            <div className="sr-hint">{t(`${money(plan.halfDollars)} each`)}</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">{t("If one falls 20%")}</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: "var(--sr-neg)" }} className="num">−{plan.drawdownImpact20}%</div>
            <div className="sr-hint">{t("portfolio impact")}</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">{t("Cap check")}</div>
            <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: plan.exceedsCap ? "var(--sr-warn)" : "var(--sr-pos)" }}>{plan.exceedsCap ? t("Over cap") : "OK"}</div>
            <div className="sr-hint">{t(`${(MAX_POSITION * 100).toFixed(0)}% max/name`)}</div>
          </div>
        </div>
      ) : (
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-4)" }}>{t("Enter a portfolio value and at least one position.")}</div>
      )}

      {/* Kelly */}
      <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)" }}>
        <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>{t("Kelly (optional edge estimate)")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", alignItems: "flex-end", marginBottom: "var(--sr-sp-2)" }}>
          <label><span style={lbl}>{t("Win prob %")}</span><input style={inputStyle} type="number" value={winProb} onChange={e => setWinProb(e.target.value)} /></label>
          <label><span style={lbl}>{t("Upside %")}</span><input style={inputStyle} type="number" value={upside} onChange={e => setUpside(e.target.value)} /></label>
          <label><span style={lbl}>{t("Downside %")}</span><input style={inputStyle} type="number" value={downside} onChange={e => setDownside(e.target.value)} /></label>
        </div>
        {k ? (
          k.favorable ? (
            <div className="sr-hint" style={{ lineHeight: 1.6 }}>
              <Trans text={`Payoff ratio <s1>${k.b}</s1> · full-Kelly <s2>${(k.full * 100).toFixed(1)}%</s2> · half-Kelly <s3>${(k.half * 100).toFixed(1)}%</s3> · capped <s4>${(k.capped * 100).toFixed(1)}%</s4>. Practitioners bet a fraction of full-Kelly.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} s3={(c) => <strong>{c}</strong>} s4={(c) => <strong style={{ color: "var(--sr-amber)" }}>{c}</strong>} /></div>
          ) : (
            <div className="sr-hint" style={{ color: "var(--sr-neg)" }}>{t("No positive edge at these inputs → Kelly says don't bet.")}</div>
          )
        ) : <div className="sr-hint">{t("Enter win probability, upside and downside.")}</div>}
      </div>
    </div>
  );
}
