// ─────────────────────────────────────────────────────────────────────────────
// GROWTH METRICS (2026-07-11) — measures the EXACT production Growth path (the real
// allocate.mjs growthWeights + applyDualMomentum + 5% BTC sleeve) over the full record
// and computes the full institutional risk report (lib/riskMetrics.ts) vs the S&P 500 —
// the evidence for Plan A's risk-adjusted claim. One code path: no re-implementation.
// BTC contributes 0 before it exists (~2018) and up to 5% (trend-gated) after. Run:
//   node --experimental-strip-types --no-warnings research/growth_metrics.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { ASSETS, growthWeights, blendWeights, applyDualMomentum, riskParity } from "./allocate.mjs";
import { riskReport } from "../lib/riskMetrics.ts";

const COST_BPS = 10;
const START = process.env.BT_START || "2007-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));
console.log(`\n  GROWTH METRICS · ${dates.length} monthly rebalances ${dates[0]}→${dates.at(-1)} · production path (with 5% BTC sleeve)`);
await preloadStationary();

const fCache = new Map();
async function fwd1(a, d) { const k = a + d; if (!fCache.has(k)) fCache.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fCache.get(k); }
async function mom(a, d) { return fwdReturn(a, addMonths(d, -12), addMonths(d, -1)); }

// Run one strategy step(date, macro) → weights; returns the monthly net-return series.
async function run(step) {
  const rets = []; let prev = {};
  for (const date of dates) {
    const macro = await regimeStationaryAsOf(date);
    const w = await step(date, macro);
    let gross = 0;
    for (const a of ASSETS) { const wa = w[a] || 0; if (!wa) continue; const r = await fwd1(a, date); if (r == null) continue; gross += wa * r; }
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    rets.push(gross - (turn / 2) * 2 * COST_BPS / 100); prev = w;
  }
  return rets;
}

// Production GROWTH: growthWeights(riskOn, btcMom) → applyDualMomentum (the exact live path).
const stepGrowth = async (date, macro) => {
  const btcM = await mom("BTCUSD", date);
  const base = growthWeights(macro.risk_on, btcM);
  const m = {}; for (const a of ASSETS) m[a] = await mom(a, date);
  return applyDualMomentum(base, m).weights;
};
// Growth WITHOUT the BTC sleeve — to isolate the sleeve's contribution honestly.
const stepGrowthNoBtc = async (date, macro) => {
  const base = growthWeights(macro.risk_on, null);
  const m = {}; for (const a of ASSETS) m[a] = await mom(a, date);
  return applyDualMomentum(base, m).weights;
};
// DEFENSIVE profile: blend + dual-mom + risk-parity (the low-drawdown mandate).
const stepDefensive = async (date, macro) => {
  const base = blendWeights(macro.risk_on);
  const m = {}, v = {};
  for (const a of ASSETS) { m[a] = await mom(a, date); }
  const gated = applyDualMomentum(base, m).weights;
  return riskParity(gated, v); // no vols in this quick pass → weights unchanged (mean-inv guard)
};
const stepSPY = async () => ({ SPY: 1 });
const step6040 = async () => ({ SPY: 0.6, IEF: 0.4 });

const spyR = await run(stepSPY);
const growthR = await run(stepGrowth);
const growthNoBtcR = await run(stepGrowthNoBtc);
const defR = await run(stepDefensive);
const b6040R = await run(step6040);

const rep = {
  growth: riskReport(growthR, spyR),
  growthNoBtc: riskReport(growthNoBtcR, spyR),
  defensive: riskReport(defR, spyR),
  bench6040: riskReport(b6040R, spyR),
  spy: riskReport(spyR),
};
const tot = (r) => { let e = 1; for (const x of r) e *= 1 + x / 100; return (e - 1) * 100; };

console.log(`\n  ${"strategy".padEnd(22)}${"total".padStart(9)}${"CAGR".padStart(7)}${"Sharpe".padStart(8)}${"Sortino".padStart(9)}${"Calmar".padStart(8)}${"maxDD".padStart(8)}${"VaR95".padStart(8)}${"CVaR95".padStart(8)}${"α".padStart(7)}${"IR".padStart(6)}`);
const line = (name, r, total) => console.log(`  ${name.padEnd(22)}${("+" + total.toFixed(0) + "%").padStart(9)}${(r.cagr + "%").padStart(7)}${String(r.sharpe).padStart(8)}${String(r.sortino).padStart(9)}${String(r.calmar).padStart(8)}${(r.maxDrawdown + "%").padStart(8)}${(r.var95 + "%").padStart(8)}${(r.cvar95 + "%").padStart(8)}${String(r.alpha ?? "—").padStart(7)}${String(r.informationRatio ?? "—").padStart(6)}`);
line("Growth (+BTC)", rep.growth, tot(growthR));
line("Growth (no BTC)", rep.growthNoBtc, tot(growthNoBtcR));
line("Defensive", rep.defensive, tot(defR));
line("Static 60/40", rep.bench6040, tot(b6040R));
line("SPY buy & hold", rep.spy, tot(spyR));

const out = { generatedAt: new Date().toISOString(), months: dates.length, window: { start: START },
  totals: { growth: +tot(growthR).toFixed(1), growthNoBtc: +tot(growthNoBtcR).toFixed(1), defensive: +tot(defR).toFixed(1), bench6040: +tot(b6040R).toFixed(1), spy: +tot(spyR).toFixed(1) },
  report: rep };
const fname = process.env.BT_START ? `growth_metrics_${START}.json` : "growth_metrics.json";
writeFileSync(join(OUT, fname), JSON.stringify(out, null, 2));
console.log(`\n  Risk-adjusted vs S&P 500: Growth Sharpe ${rep.growth.sharpe} / Sortino ${rep.growth.sortino} vs SPY ${rep.spy.sharpe} / ${rep.spy.sortino}; maxDD ${rep.growth.maxDrawdown}% vs ${rep.spy.maxDrawdown}%; Jensen α ${rep.growth.alpha}%/yr; IR ${rep.growth.informationRatio}.`);
console.log(`  → wrote research/out/${fname}\n`);
