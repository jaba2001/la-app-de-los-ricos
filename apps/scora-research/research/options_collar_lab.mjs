// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS COLLAR LAB (Plan D, 2026-07-11) — the last untested path to "less drawdown
// than the S&P while keeping most of the upside": an options collar / protective-put
// overlay on the Growth equity sleeve. No free options-price history exists, so we do the
// standard, defensible thing: MODEL each option with Black-Scholes using the VIX as the
// implied vol (VIX is 30-day SPX implied vol — exactly right for 1-month SPY options). This
// captures the REAL cost of hedging honestly — implied vol (VIX) runs above realized, so
// long puts bleed and short calls collect the variance risk premium, just like in life.
//   Collar = long put @ S(1−p) + short call @ S(1+c) on the SPY sleeve, 1-month, rolled
//   monthly. Payoff to expiry = clamp(SPY return, −p, +c) − net premium. Applied only when
//   Growth holds equities (risk-on); defensive months are already de-risked.
// Verdict is measured, not assumed (like the leverage/CPPI rejection). Run:
//   node --experimental-strip-types --no-warnings research/options_collar_lab.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn, priceAsOf } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { ASSETS, growthWeights, applyDualMomentum } from "./allocate.mjs";
import { riskReport } from "../lib/riskMetrics.ts";

const COST_BPS = 10;
const OPT_SLIPPAGE = 0.001; // 10bp round-trip friction per option leg (bid/ask) — conservative
const START = process.env.BT_START || "2007-01-01";
const R = 0.02, Q = 0.015; // risk-free & SPY dividend yield (minor at 1-month tenor)
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));
console.log(`\n  OPTIONS COLLAR LAB · ${dates.length} monthly rebalances ${dates[0]}→${dates.at(-1)} · BS-priced via VIX`);
await preloadStationary();

// ── Black-Scholes (with continuous dividend q) ────────────────────────────────
function ncdf(x) { // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function bs(cp, S, K, T, sig, r = R, q = Q) {
  if (sig <= 0 || T <= 0) return Math.max(0, cp === "c" ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r - q + sig * sig / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return cp === "c"
    ? S * Math.exp(-q * T) * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2)
    : K * Math.exp(-r * T) * ncdf(-d2) - S * Math.exp(-q * T) * ncdf(-d1);
}

const fCache = new Map();
async function fwd1(a, d) { const k = a + d; if (!fCache.has(k)) fCache.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fCache.get(k); }
async function mom(a, d) { return fwdReturn(a, addMonths(d, -12), addMonths(d, -1)); }
const vixCache = new Map();
async function vixAsOf(d) { if (!vixCache.has(d)) vixCache.set(d, await priceAsOf("^VIX", d)); return vixCache.get(d); }

// One month's collared SPY return (%): buy put @S(1−p), sell call @S(1+c), 1-month, VIX vol.
// overlay = { p, c } as decimals; c = null → protective-put only (no cap).
async function collaredSpyRet(date, spyRet, overlay) {
  const vix = await vixAsOf(date);
  const sig = vix != null && vix > 0 ? vix / 100 : 0.18; // fallback ~18% vol
  const S = 100, T = 1 / 12;
  const putK = S * (1 - overlay.p);
  const putPrem = bs("p", S, putK, T, sig) / S + OPT_SLIPPAGE;      // cost of protection
  let callPrem = 0, cap = Infinity;
  if (overlay.c != null) { const callK = S * (1 + overlay.c); callPrem = bs("c", S, callK, T, sig) / S - OPT_SLIPPAGE; cap = overlay.c * 100; }
  const net = putPrem - callPrem;                                    // net premium (% of S)
  const floored = Math.max(spyRet, -overlay.p * 100);                // put floor
  const capped = Math.min(floored, cap);                            // call cap (if any)
  return capped - net * 100;
}

async function runGrowth(overlay) {
  const rets = []; let prev = {};
  for (const date of dates) {
    const macro = await regimeStationaryAsOf(date);
    const btcM = await mom("BTCUSD", date);
    const base = growthWeights(macro.risk_on, btcM);
    const m = {}; for (const a of ASSETS) m[a] = await mom(a, date);
    const w = applyDualMomentum(base, m).weights;
    let gross = 0;
    for (const a of ASSETS) {
      const wa = w[a] || 0; if (!wa) continue;
      let r = await fwd1(a, date); if (r == null) continue;
      if (a === "SPY" && overlay) r = await collaredSpyRet(date, r, overlay); // hedge the equity sleeve
      gross += wa * r;
    }
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    rets.push(gross - (turn / 2) * 2 * COST_BPS / 100); prev = w;
  }
  return rets;
}
async function runSPY() { const rets = []; for (const d of dates) { const r = await fwd1("SPY", d); rets.push(r ?? 0); } return rets; }

const spyR = await runSPY();
const variants = [
  ["Growth (no hedge)", null],
  ["Collar 5/10 (put−5 call+10)", { p: 0.05, c: 0.10 }],
  ["Collar 5/5 (symmetric)", { p: 0.05, c: 0.05 }],
  ["Collar 8/12", { p: 0.08, c: 0.12 }],
  ["Protective put −5% (no cap)", { p: 0.05, c: null }],
  ["Tail put −10% (cheap)", { p: 0.10, c: null }],
];
const results = {};
console.log(`\n  ${"variant".padEnd(30)}${"total".padStart(9)}${"CAGR".padStart(7)}${"Sharpe".padStart(8)}${"Sortino".padStart(9)}${"Calmar".padStart(8)}${"maxDD".padStart(8)}`);
for (const [name, ov] of variants) {
  const r = await runGrowth(ov);
  const rep = riskReport(r, spyR);
  let eq = 1; for (const x of r) eq *= 1 + x / 100; const total = (eq - 1) * 100;
  results[name] = { total: +total.toFixed(1), ...rep };
  console.log(`  ${name.padEnd(30)}${("+" + total.toFixed(0) + "%").padStart(9)}${(rep.cagr + "%").padStart(7)}${String(rep.sharpe).padStart(8)}${String(rep.sortino).padStart(9)}${String(rep.calmar).padStart(8)}${(rep.maxDrawdown + "%").padStart(8)}`);
}
const spyRep = riskReport(spyR); let se = 1; for (const x of spyR) se *= 1 + x / 100;
console.log(`  ${"SPY buy & hold".padEnd(30)}${("+" + ((se - 1) * 100).toFixed(0) + "%").padStart(9)}${(spyRep.cagr + "%").padStart(7)}${String(spyRep.sharpe).padStart(8)}${String(spyRep.sortino).padStart(9)}${String(spyRep.calmar).padStart(8)}${(spyRep.maxDrawdown + "%").padStart(8)}`);

const base = results["Growth (no hedge)"];
console.log(`\n  ── Does any hedge cut Growth's ${base.maxDrawdown}% drawdown further WITHOUT wrecking risk-adjusted return? ──`);
for (const [name] of variants.slice(1)) {
  const r = results[name];
  const lowerDD = r.maxDrawdown > base.maxDrawdown, keepsSharpe = r.sharpe >= base.sharpe - 0.02, keepsCalmar = r.calmar >= base.calmar - 0.02;
  const verdict = lowerDD && (keepsSharpe || keepsCalmar) ? "✓ EARNS IT" : lowerDD ? "~ less DD but risk-adj worse" : "✗ no DD benefit";
  console.log(`  ${verdict.padEnd(30)} ${name.padEnd(30)} DD ${r.maxDrawdown}% vs ${base.maxDrawdown}% · Sharpe ${r.sharpe} vs ${base.sharpe} · Calmar ${r.calmar} vs ${base.calmar} · ret ${r.total}% vs ${base.total}%`);
}
const fname = process.env.BT_START ? `options_collar_lab_${START}.json` : "options_collar_lab.json";
writeFileSync(join(OUT, fname), JSON.stringify({ generatedAt: new Date().toISOString(), months: dates.length, spy: { total: +((se - 1) * 100).toFixed(1), ...spyRep }, results }, null, 2));
console.log(`\n  → wrote research/out/${fname}\n`);
