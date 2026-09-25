// ─────────────────────────────────────────────────────────────────────────────
// 0B · MULTI-ASSET OVERLAY BACKTEST — Layer 2. Monthly rebalance across SPY/TLT/IEF/
// GLD/DBC/BIL by the PRODUCTION regime (regimeReal.mjs → lib/server/macro.js), with
// Antonacci absolute-momentum gating. Measures whether regime-driven allocation beats
// buy-and-hold SPY on return, Sharpe and drawdown — the "big alpha, free with ETFs"
// thesis. Reports three curves so the momentum overlay's contribution is isolated:
//   • Regime          — weights by regime only
//   • Regime+DualMom   — weights by regime, risk sleeves gated by 12-1m absolute mom
//   • Static 60/40     — 60% SPY / 40% IEF, monthly rebalanced (context benchmark)
// vs SPY buy-and-hold. Run:
//   node --experimental-strip-types --no-warnings research/backtest_assets.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn, returnsSeries } from "./prices.mjs";
import { regimeAsOf, preloadRegimeSeries } from "./regimeReal.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { ASSETS, targetWeights, applyDualMomentum, blendWeights, riskParity as riskParityWithVols } from "./allocate.mjs";

// REGIME=stationary → use the historically-valid stationary regime (Phase 1); default
// = production regime (reliable ~2019+ only). See regimeStationary.mjs for why.
const useStationary = process.env.REGIME === "stationary";
const regimeFn = useStationary ? regimeStationaryAsOf : regimeAsOf;

const COST_BPS = 10;             // per side, per unit turnover
// Analysis window. Default matches the equity backtest (2020+); override with BT_START
// to stress the regime weights over more cycles (GFC 2008, Euro 2011, Q4-18, 2022).
const START = process.env.BT_START || "2020-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const pct = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);

const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));

console.log(`\n  SCORA 0B · multi-asset overlay · ${dates.length} monthly rebalances ${dates[0]}→${dates.at(-1)} · regime=${useStationary ? "STATIONARY" : "production"}\n  loading regime + prices…`);
if (useStationary) await preloadStationary(); else await preloadRegimeSeries();

// forward 1M return per asset (cache), 12-1m momentum per asset (cache)
const fCache = new Map();
async function fwd1(asset, date) { const k = `${asset}/${date}`; if (!fCache.has(k)) fCache.set(k, await fwdReturn(asset, date, addMonths(date, 1))); return fCache.get(k); }
async function mom12_1(asset, date) { return fwdReturn(asset, addMonths(date, -12), addMonths(date, -1)); }

// run one strategy; step(date,regime) → weights map. Returns curve stats + monthly rets.
async function runStrategy(step) {
  let eq = 1, peak = 1, maxDD = 0; const rets = []; let prev = {}; const byRegime = {};
  for (const date of dates) {
    const macro = await regimeFn(date);
    const w = await step(date, macro);
    // gross next-month return
    let gross = 0, wsum = 0;
    for (const a of ASSETS) { const wa = w[a] || 0; if (!wa) continue; const r = await fwd1(a, date); if (r == null) continue; gross += wa * r; wsum += wa; }
    if (wsum > 0 && wsum < 0.999) gross += (1 - wsum) * 0; // uninvested → cash 0% (rare)
    // turnover cost
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    const cost = (turn / 2) * 2 * COST_BPS / 100; // round-trip on the changed fraction
    const net = gross - cost;
    eq *= 1 + net / 100; rets.push(net); prev = w;
    peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq / peak - 1);
    (byRegime[macro.regime_id] ||= []).push(net);
  }
  return { total: (eq - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : null, maxDD: maxDD * 100, rets, byRegime };
}

// strategies
const stepRegime = async (_d, macro) => targetWeights(macro.regime_id);
const stepRegimeDM = async (date, macro) => {
  const base = targetWeights(macro.regime_id);
  const mom = {};
  for (const a of ASSETS) mom[a] = await mom12_1(a, date);
  return applyDualMomentum(base, mom).weights;
};
const step6040 = async () => ({ SPY: 0.6, IEF: 0.4 });
const stepSPY = async () => ({ SPY: 1 });
// Regime-INDEPENDENT dual-momentum sleeve (equal-weight risk assets gated by 12-1m
// absolute momentum → cash). This is the honest long-history robustness control: it
// needs NO regime labels, so — unlike the regime strategies — it is trustworthy back
// to the GFC even though the production regime engine's composites aren't (LCC uses
// absolute-$ thresholds calibrated to recent levels; SOFR from 2018; HY OAS from 2023).
const stepMomOnly = async (date) => {
  const base = { SPY: 0.2, TLT: 0.2, IEF: 0.2, GLD: 0.2, DBC: 0.2 };
  const mom = {};
  for (const a of ASSETS) mom[a] = await mom12_1(a, date);
  return applyDualMomentum(base, mom).weights;
};

// Phase-1 recalibration: continuous liquidity-led risk-on tilt (uses macro.risk_on from
// the stationary regime), with and without the dual-momentum overlay. The overlay's
// fairest test vs the regime-free DualMom-only control.
const stepRiskOn = async (_d, macro) => blendWeights(macro.risk_on);
const stepRiskOnDM = async (date, macro) => {
  const base = blendWeights(macro.risk_on);
  const mom = {};
  for (const a of ASSETS) mom[a] = await mom12_1(a, date);
  return applyDualMomentum(base, mom).weights;
};

// A6 — risk-aware (inverse-volatility) sizing. Trailing realized vol per asset ending at
// `date`, memoized. "The covariance structure IS the object" — size by risk, not by a fixed
// basket, so a low-vol bond and a high-vol commodity don't carry the same risk at equal weight.
const vsCache = new Map();
async function volAsOf(asset, date, win = 63) {
  const k = `${asset}/${date}/${win}`;
  if (vsCache.has(k)) return vsCache.get(k);
  const r = await returnsSeries(asset);
  let hi = -1; for (let i = 0; i < r.length; i++) { if (r[i].date <= date) hi = i; else break; }
  let v = null;
  if (hi >= win) { const w = r.slice(hi - win + 1, hi + 1).map((x) => x.ret); const m = w.reduce((s, x) => s + x, 0) / w.length; v = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / (w.length - 1)); }
  vsCache.set(k, v); return v;
}
// Collect trailing vols as of `date` and delegate the math to the SHARED riskParity in
// allocate.mjs — the exact function production runs (lib/allocation.ts is its TS twin,
// guarded by a parity test in scripts/golden.test.mjs). One code path, no drift.
async function riskParity(weights, date) {
  const vols = {};
  for (const a of ASSETS) { if (a !== "BIL" && (weights[a] || 0) > 0) vols[a] = await volAsOf(a, date); }
  return riskParityWithVols(weights, vols);
}
const stepRiskOnDM_RP = async (date, macro) => {
  const base = blendWeights(macro.risk_on);
  const mom = {};
  for (const a of ASSETS) mom[a] = await mom12_1(a, date);
  const gated = applyDualMomentum(base, mom).weights;
  return riskParity(gated, date);
};

const [reg, regDM, riskOn, riskOnDM, riskOnRP, momOnly, s6040, spy] = [
  await runStrategy(stepRegime), await runStrategy(stepRegimeDM),
  await runStrategy(stepRiskOn), await runStrategy(stepRiskOnDM),
  await runStrategy(stepRiskOnDM_RP),
  await runStrategy(stepMomOnly), await runStrategy(step6040), await runStrategy(stepSPY)];

const line = (name, r) => `  ${name.padEnd(26)} ${pct(r.total).padStart(7)}%   Sharpe ${r.sharpe != null ? r.sharpe.toFixed(2) : "—"}   maxDD ${pct(r.maxDD).padStart(6)}%`;
console.log(`\n  ── ${dates.length}-month curves (net of ${COST_BPS}bps/side turnover) ──`);
console.log(line("Regime discrete", reg));
console.log(line("Regime discrete + DualMom", regDM));
console.log(line("RiskOn tilt (continuous)", riskOn));
console.log(line("RiskOn tilt + DualMom", riskOnDM));
console.log(line("RiskOn + DualMom + RiskParity", riskOnRP));
console.log(line("DualMom-only (no regime)", momOnly));
console.log(line("Static 60/40", s6040));
console.log(line("SPY buy & hold", spy));

// regime breakdown for the DualMom strategy
console.log("\n  ── Regime+DualMom · avg monthly net return by regime ──");
for (const rg of ["expansion", "reflation", "stagflation", "contraction", "neutral"]) {
  const a = regDM.byRegime[rg]; if (!a) continue;
  console.log(`  ${rg.padEnd(12)} ${String(a.length).padStart(3)} mo · avg ${pct(mean(a))}%/mo`);
}

// Sub-period robustness: how the (untuned, literature-based) weights hold up before vs
// during the original 2020-26 design window. A pre-2020 slice is effectively OOS.
function subStats(rets) {
  if (rets.length < 6) return null;
  let eq = 1, peak = 1, dd = 0;
  for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); }
  return { total: (eq - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : null, maxDD: dd * 100, months: rets.length };
}
const splitIdx = dates.findIndex((d) => d >= "2020-01-01");
if (splitIdx > 6) {
  console.log("\n  ── Sub-period robustness (pre-2020 = out-of-sample) ──");
  console.log("  NOTE: regime strategies are UNRELIABLE pre-~2019 (composites calibrated to");
  console.log("  recent absolute levels). DualMom-only needs no regime → its pre-2020 is valid.");
  const slabs = [["pre-2020 (OOS)", 0, splitIdx], ["2020-2026", splitIdx, dates.length]];
  const row = (lbl, r, a, b) => { const s = subStats(r.rets.slice(a, b)); return s ? `${(pct(s.total) + "%").padStart(8)} / ${s.sharpe?.toFixed(2)} / ${pct(s.maxDD)}%` : "—"; };
  console.log("  period            RiskOn+DM (recalibrated)      DualMom-only (control)         SPY");
  for (const [lbl, a, b] of slabs) {
    console.log(`  ${lbl.padEnd(16)} ${row(lbl, riskOnDM, a, b).padEnd(29)} ${row(lbl, momOnly, a, b).padEnd(30)} ${row(lbl, spy, a, b)}`);
  }
}

// Verdict — does the RECALIBRATED overlay (RiskOn tilt + DualMom) beat the regime-free
// DualMom-only control out-of-cycle? That is the overlay's fair second chance.
const dMom = momOnly.sharpe ?? 0, dRisk = riskOnDM.sharpe ?? 0;
const overlayAdds = dRisk > dMom + 0.03 || (Math.abs(dRisk - dMom) <= 0.05 && riskOnDM.maxDD > momOnly.maxDD + 1);
const verdict = overlayAdds
  ? `OVERLAY EARNS ITS PLACE — RiskOn+DM Sharpe ${dRisk.toFixed(2)} vs DualMom-only ${dMom.toFixed(2)}, DD ${pct(riskOnDM.maxDD)}% vs ${pct(momOnly.maxDD)}% over ${dates.length} months. Keep the macro overlay as core.`
  : `OVERLAY DOES NOT ADD (even recalibrated) — RiskOn+DM Sharpe ${dRisk.toFixed(2)} ≤ DualMom-only ${dMom.toFixed(2)} (DD ${pct(riskOnDM.maxDD)}% vs ${pct(momOnly.maxDD)}%). Dual-momentum is the edge; demote regime to optional context.`;
console.log(`\n  Verdict: ${verdict}`);

// A6 gate — does inverse-vol (risk-parity) sizing improve the validated allocator OOS?
const baseS = riskOnDM.sharpe ?? 0, rpS = riskOnRP.sharpe ?? 0;
const rpBetter = rpS > baseS + 0.03 || (Math.abs(rpS - baseS) <= 0.05 && riskOnRP.maxDD > riskOnDM.maxDD + 1);
const a6verdict = rpBetter
  ? `A6 RISK-PARITY EARNS ITS PLACE — Sharpe ${rpS.toFixed(2)} vs ${baseS.toFixed(2)}, maxDD ${pct(riskOnRP.maxDD)}% vs ${pct(riskOnDM.maxDD)}%. Ship inverse-vol sizing to the allocator/paper fund.`
  : `A6 RISK-PARITY DOES NOT ADD — Sharpe ${rpS.toFixed(2)} ≤ ${baseS.toFixed(2)} (maxDD ${pct(riskOnRP.maxDD)}% vs ${pct(riskOnDM.maxDD)}%). Keep the current sizing; risk-parity stays optional context, not core.`;
console.log(`\n  Gate A6: ${a6verdict}`);

writeFileSync(join(OUT, "backtest_assets_summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), months: dates.length, regime: reg, regimeDualMom: regDM, riskOn, riskOnDM, riskOnRP, momOnly, static6040: s6040, spy, verdict, a6verdict }, null, 2));
console.log(`\n  → wrote research/out/backtest_assets_summary.json\n`);
