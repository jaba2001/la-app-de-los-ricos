"use client";
import { useMemo, useState } from "react";
import type { MacroState } from "@/lib/types";
import { bondEtfModel, bondMetrics, treasuryCurve, curveYield, priceChangePct, regimeRateView, effectiveDuration, impliedCreditLoss } from "@/lib/bonds";
import { t, tv } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

interface Props { ticker: string; macro: MacroState | null; price: number | null; }

const bp = (n: number) => `${n > 0 ? "+" : ""}${n}bp`;
const pctSigned = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;

export default function BondCockpit({ ticker, macro, price }: Props) {
  const model = useMemo(() => bondEtfModel(ticker, macro), [ticker, macro]);
  const view = useMemo(() => regimeRateView(macro), [macro]);
  const [rateBp, setRateBp] = useState(0);
  const [spreadBp, setSpreadBp] = useState(0);

  // Treasury synthetic calculator
  const [coupon, setCoupon] = useState(4);
  const [maturity, setMaturity] = useState(10);
  const curve = useMemo(() => treasuryCurve(macro), [macro]);
  const synthYtm = useMemo(() => curveYield(curve, maturity), [curve, maturity]);
  const synth = useMemo(() => (synthYtm != null ? bondMetrics(coupon, synthYtm, maturity) : null), [coupon, synthYtm, maturity]);

  if (!model) {
    // Not a known bond ETF — still offer the Treasury calculator standalone.
    return <TreasuryCalc {...{ coupon, setCoupon, maturity, setMaturity, synthYtm, synth, curveLen: curve.length }} />;
  }

  const { meta, baseYield, spreadBp: modelSpread, metrics, curveAt } = model;
  const isCredit = meta.category === "IG credit" || meta.category === "High yield" || meta.category === "Aggregate";
  const credit = isCredit && modelSpread > 0 ? impliedCreditLoss(modelSpread, 0.6) : null;
  const dY = (rateBp + spreadBp) / 100; // total yield shift in %-points
  const impact = priceChangePct(metrics.modified, metrics.convexity, dY);
  const totalReturn1y = baseYield + impact; // carry + price move
  const regimeDy = view.bps / 100;
  const regimeImpact = priceChangePct(metrics.modified, metrics.convexity, regimeDy);
  const regimeTR = baseYield + regimeImpact;

  const stat = (label: string, val: string, sub?: string) => (
    <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{tv(label)}</div>
      <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 800 }} className="num">{val}</div>
      {sub && <div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{tv(sub)}</div>}
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">{t(`Bond cockpit · ${meta.label} (${meta.category})`)}</div>
      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>
        {t(`Modelled as a synthetic par bond at its ~${meta.avgMaturity}yr average maturity, priced off Scora's live Treasury curve + credit spread. Educational — not advice.`)}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)" }}>
        {stat("Est. yield", `${baseYield.toFixed(2)}%`, `curve ${curveAt.toFixed(2)}% + ${modelSpread.toFixed(0)}bp`)}
        {stat("Mod. duration", `${metrics.modified.toFixed(1)}y`, "price sens. to rates")}
        {stat("Convexity", metrics.convexity.toFixed(1), "2nd-order")}
        {stat("Price", price != null ? `$${price.toFixed(2)}` : "—", "Yahoo close")}
      </div>

      {/* Sliders */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
        <div>
          <div className="sr-flex-between" style={{ fontSize: "var(--sr-t-xs)", marginBottom: 3 }}>
            <span style={{ color: "var(--sr-text-2)" }}>{t("Rate shift")}</span>
            <span className="num" style={{ color: "var(--sr-text)" }}>{bp(rateBp)}</span>
          </div>
          <input type="range" min={-200} max={200} step={5} value={rateBp} onChange={(e) => setRateBp(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--sr-amber)" }} />
        </div>
        <div>
          <div className="sr-flex-between" style={{ fontSize: "var(--sr-t-xs)", marginBottom: 3 }}>
            <span style={{ color: "var(--sr-text-2)" }}>{t("Credit-spread shift")}</span>
            <span className="num" style={{ color: "var(--sr-text)" }}>{bp(spreadBp)}</span>
          </div>
          <input type="range" min={-200} max={200} step={5} value={spreadBp} onChange={(e) => setSpreadBp(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--sr-amber)" }} disabled={meta.category === "Treasury"} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-2)", marginTop: "var(--sr-sp-3)" }}>
        <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${impact >= 0 ? "var(--sr-pos)" : "var(--sr-neg)"} 10%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${impact >= 0 ? "var(--sr-pos)" : "var(--sr-neg)"} 26%, transparent)` }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase" }}>{t("Price impact")}</div>
          <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: impact >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">{pctSigned(impact)}</div>
        </div>
        <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${totalReturn1y >= 0 ? "var(--sr-pos)" : "var(--sr-neg)"} 10%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${totalReturn1y >= 0 ? "var(--sr-pos)" : "var(--sr-neg)"} 26%, transparent)` }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase" }}>{t("1y total return")}</div>
          <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: totalReturn1y >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">{pctSigned(totalReturn1y)}</div>
          <div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{t(`carry ${baseYield.toFixed(1)}% + price ${pctSigned(impact)}`)}</div>
        </div>
      </div>

      {/* Credit loss decomposition (OAS → implied PD) */}
      {credit && (
        <div style={{ marginTop: "var(--sr-sp-3)", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sr-sp-2)" }}>
          {stat("OAS", `${modelSpread.toFixed(0)}bp`, "credit spread")}
          {stat("Implied PD (1y)", `${(credit.impliedPD1y * 100).toFixed(1)}%`, `LGD ${(credit.lgd * 100).toFixed(0)}%`)}
          {stat("Implied PD (5y)", `${(credit.impliedPD5y * 100).toFixed(0)}%`, "cumulative")}
        </div>
      )}

      {/* ★ Regime overlay — the edge */}
      <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
        <div className="sr-flex-between" style={{ marginBottom: 4 }}>
          <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: "var(--sr-text)" }}>{t("Scora regime rate view")}</span>
          <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 800, color: view.bias === "lower" ? "var(--sr-pos)" : view.bias === "higher" ? "var(--sr-neg)" : "var(--sr-text-2)" }}>
            {t(`rates ${view.bias} (${bp(view.bps)} 10y)`)}</span>
        </div>
        <div style={{ fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>{view.reasons.map((r) => t(r)).join(" · ")}</div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", marginTop: 6 }}>
          {t("If that rate view realizes → est. 1y total return")}{" "}<strong className="num" style={{ color: regimeTR >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>{pctSigned(regimeTR)}</strong> <span style={{ color: "var(--sr-text-3)" }}>{t(`(duration ${metrics.modified.toFixed(1)}y × ${bp(view.bps)})`)}</span>
        </div>
      </div>

      {/* Credit market context (P2-12) — HY OAS tiers from macro_state, free (FRED) */}
      {macro?.hy_oas != null && (
        <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
          <div className="sr-flex-between" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: "var(--sr-text)" }}>{t("Credit market context")}</span>
            {macro.hy_oas_momentum != null && (
              <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: macro.hy_oas_momentum > 0 ? "var(--sr-neg)" : "var(--sr-pos)" }}>
                {t("spreads")}{" "}{macro.hy_oas_momentum > 0 ? t("widening") : t("tightening")} ({bp(Math.round(macro.hy_oas_momentum))})
              </span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-2)" }}>
            {stat("HY OAS", `${macro.hy_oas.toFixed(0)}bp`, "high yield")}
            {stat("BBB OAS", macro.bbb_oas != null ? `${macro.bbb_oas.toFixed(0)}bp` : "—", "investment grade")}
            {stat("BB OAS", macro.hy_bb_oas != null ? `${macro.hy_bb_oas.toFixed(0)}bp` : "—", "top of junk")}
            {stat("CCC OAS", macro.hy_ccc_oas != null ? `${macro.hy_ccc_oas.toFixed(0)}bp` : "—", "distress tier")}
          </div>
          <div className="sr-hint" style={{ marginTop: 6, lineHeight: 1.5 }}>
            {macro.hy_oas < 350 ? t("Spreads are tight — credit is complacent; little cushion if defaults tick up.")
              : macro.hy_oas > 600 ? t("Spreads are wide — credit is pricing stress; carry is rich but default risk is real.")
              : t("Spreads are mid-range — credit neither cheap nor euphoric.")}
            {macro.credit_divergence ? t(" ⚠ Hidden divergence: public HY looks calm but the private-credit proxy is weakening.") : ""}
            {t(" A covenant-quality read needs issuer-level covenant data (paid) — see the roadmap's paid-data tier.")}
          </div>
        </div>
      )}

      <div style={{ marginTop: "var(--sr-sp-4)", paddingTop: "var(--sr-sp-3)", borderTop: "1px solid var(--sr-border)" }}>
        <TreasuryCalc {...{ coupon, setCoupon, maturity, setMaturity, synthYtm, synth, curveLen: curve.length }} />
      </div>
    </div>
  );
}

// ── Synthetic Treasury calculator (coupon/maturity → price/YTM/duration off FRED curve) ──
function TreasuryCalc({ coupon, setCoupon, maturity, setMaturity, synthYtm, synth, curveLen }: {
  coupon: number; setCoupon: (n: number) => void; maturity: number; setMaturity: (n: number) => void;
  synthYtm: number | null; synth: { price: number; modified: number; convexity: number } | null; curveLen: number;
}) {
  return (
    <div>
      <div className="section-label" style={{ margin: "0 0 var(--sr-sp-2)" }}>{t("Treasury calculator (FRED curve)")}</div>
      {curveLen === 0 ? (
        <div className="sr-hint">{t("Treasury curve not available.")}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "var(--sr-sp-4)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
            <label style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)" }}>
              {t("Coupon %")}<input type="number" value={coupon} step={0.25} min={0} max={15} onChange={(e) => setCoupon(Number(e.target.value))} style={{ width: 70, marginLeft: 6, background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: 4, color: "var(--sr-text)", padding: "2px 6px" }} className="num" />
            </label>
            <label style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)" }}>
              {t("Maturity (yr)")}<input type="number" value={maturity} step={1} min={0.25} max={30} onChange={(e) => setMaturity(Number(e.target.value))} style={{ width: 70, marginLeft: 6, background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: 4, color: "var(--sr-text)", padding: "2px 6px" }} className="num" />
            </label>
          </div>
          {synth && synthYtm != null && (
            <div style={{ display: "flex", gap: "var(--sr-sp-4)", flexWrap: "wrap", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
              <span><Trans text={`YTM (curve): <s1>${synthYtm.toFixed(2)}%</s1>`} s1={(c) => <strong className="num" style={{ color: "var(--sr-text)" }}>{c}</strong>} /></span>
              <span><Trans text={`Price: <s1>$${synth.price.toFixed(2)}</s1>`} s1={(c) => <strong className="num" style={{ color: "var(--sr-text)" }}>{c}</strong>} /></span>
              <span><Trans text={`Mod. duration: <s1>${synth.modified.toFixed(1)}y</s1>`} s1={(c) => <strong className="num" style={{ color: "var(--sr-text)" }}>{c}</strong>} /></span>
              <span><Trans text={`Eff. duration: <s1>${effectiveDuration(coupon, synthYtm, maturity).toFixed(1)}y</s1>`} s1={(c) => <strong className="num" style={{ color: "var(--sr-text)" }}>{c}</strong>} /></span>
              <span><Trans text={`Convexity: <s1>${synth.convexity.toFixed(1)}</s1>`} s1={(c) => <strong className="num" style={{ color: "var(--sr-text)" }}>{c}</strong>} /></span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
