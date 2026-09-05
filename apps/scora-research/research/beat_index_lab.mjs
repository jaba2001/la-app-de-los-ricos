// ─────────────────────────────────────────────────────────────────────────────
// BEAT-THE-INDEX LAB (2026-07-11) — the user's brief: beat the S&P 500 on TOTAL
// RETURN with a smaller drawdown, credibly, without inventing anything. The naive
// aggressive lab proved nothing UNLEVERED beats SPY's +652%. The legitimate menu
// (from the CAIA + portfolio-management curriculum) that CAN, applied to Scora's
// validated high-Sharpe base:
//   1. REGIME-CONDITIONAL LEVERAGE — lever ONLY in high-conviction risk-on+uptrend
//      months (naive always-on 2× fails via vol decay; conditional is the Sharpe
//      argument: a 1.0-Sharpe base levered to SPY's vol should beat SPY on both).
//      Expressed with SSO (real 2× SPY ETF, 2006+), never synthetic.
//   2. CPPI — dynamic exposure m·(NAV − floor), floor trails the peak; convex
//      participation with a hard-ish floor (Escuela FEF portfolio-insurance module).
//   3. SMALL CRYPTO SLEEVE — 5% BTC (Grayscale/CAIA: 5% maximizes Sharpe),
//      trend-gated. BTC only exists ~2018+ on free data and its past returns will
//      NOT repeat → reported on its own short window, explicitly caveated, small.
// All monthly rebalance, net 10bp/side, stationary regime. Run:
//   node --experimental-strip-types --no-warnings research/beat_index_lab.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";

const COST_BPS = 10;
const START = process.env.BT_START || "2007-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const ASSETS = ["SPY", "SSO", "TLT", "IEF", "GLD", "DBC", "BIL", "BTC-USD"];
const OFF = { SPY: 0.15, TLT: 0.25, IEF: 0.20, GLD: 0.20, DBC: 0.05, BIL: 0.15 };

const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));
console.log(`\n  BEAT-INDEX LAB · ${dates.length} monthly rebalances ${dates[0]}→${dates.at(-1)} · stationary regime · window from ${START}`);
await preloadStationary();

const fCache = new Map();
async function fwd1(asset, date) { const k = `${asset}/${date}`; if (!fCache.has(k)) fCache.set(k, await fwdReturn(asset, date, addMonths(date, 1))); return fCache.get(k); }
async function mom12_1(asset, date) { return fwdReturn(asset, addMonths(date, -12), addMonths(date, -1)); }

// runStrategy returns curve stats + the equity path (for the CPPI overlay, which needs NAV).
async function runStrategy(step) {
  let eq = 1, peak = 1, maxDD = 0; const rets = []; let prev = {};
  const ctx = { navPeak: 1 }; // CPPI state passed to step
  for (const date of dates) {
    const macro = await regimeStationaryAsOf(date);
    ctx.nav = eq; ctx.navPeak = peak;
    const w = await step(date, macro, ctx);
    let gross = 0;
    for (const a of ASSETS) { const wa = w[a] || 0; if (!wa) continue; const r = await fwd1(a, date); if (r == null) continue; gross += wa * r; }
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    const net = gross - (turn / 2) * 2 * COST_BPS / 100;
    eq *= 1 + net / 100; rets.push(net); prev = w;
    peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq / peak - 1);
  }
  const years = dates.length / 12;
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 1 / years) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : null, maxDD: maxDD * 100 };
}

// Express an equity exposure e∈[0,2] with SPY + SSO(2×): e = spy + 2·sso.
// e≤1 → {SPY:e, BIL:1−e}; e>1 → {SPY:2−e, SSO:e−1} (fully invested, real ETFs).
const equityAt = (e) => e <= 1 ? { SPY: +e.toFixed(4), BIL: +(1 - e).toFixed(4) } : { SPY: +(2 - e).toFixed(4), SSO: +(e - 1).toFixed(4) };
const spyMomUp = async (date) => { const m = await mom12_1("SPY", date); return m == null || m > 0; };

// ── Strategies ────────────────────────────────────────────────────────────────
const stepSPY = async () => ({ SPY: 1 });
const step6040 = async () => ({ SPY: 0.6, IEF: 0.4 });
// Growth (current default): 100% equity risk-on, defensive off, 12-1m gate.
const stepGrowth = async (date, m) => (m.risk_on ?? 50) >= 50 ? (await spyMomUp(date) ? { SPY: 1 } : { ...OFF }) : { ...OFF };

// 1) Regime-conditional leverage: lever to LEV only in the high-conviction cell.
const levGrowth = (LEV, hurdle) => async (date, m) => {
  const ro = m.risk_on ?? 50;
  if (ro < 50) return { ...OFF };
  if (!(await spyMomUp(date))) return { ...OFF };
  return equityAt(ro >= hurdle ? LEV : 1);
};

// 2) CPPI overlay on the growth base: risk-asset exposure = m·(NAV − floor)/NAV,
//    floor = navPeak·(1−maxLoss). Capped at LEVMAX. Risk-off → defensive basket.
const cppi = (mult, maxLoss, LEVMAX) => async (date, m, ctx) => {
  const ro = m.risk_on ?? 50;
  if (ro < 50 || !(await spyMomUp(date))) return { ...OFF };
  const floor = ctx.navPeak * (1 - maxLoss);
  const cushion = Math.max(0, (ctx.nav - floor) / ctx.nav);
  const e = Math.max(0.2, Math.min(LEVMAX, mult * cushion));
  return equityAt(e);
};

// 3) BTC sleeve: carve `w` from the equity sleeve into BTC when BTC 12-1m > 0.
const withBtc = (base, w) => async (date, m, ctx) => {
  const b = await mom12_1("BTC-USD", date);
  const wt = await base(date, m, ctx);
  if (b == null || b <= 0) return wt;                       // trend gate: no BTC in downtrends
  const eq = (wt.SPY || 0) + (wt.SSO || 0) * 2;             // current equity exposure
  if (eq <= 0) return wt;                                   // don't add BTC in risk-off
  const out = { ...wt };
  const scale = Math.max(0, 1 - w / Math.max(eq, w));       // shrink equity to fund BTC
  out.SPY = (wt.SPY || 0) * scale; out.SSO = (wt.SSO || 0) * scale;
  out["BTC-USD"] = w;
  return out;
};

const NAMES = [
  ["SPY buy & hold",                stepSPY],
  ["Static 60/40",                  step6040],
  ["Growth (current default)",      stepGrowth],
  ["Lev 1.3× (ro≥65 & uptrend)",    levGrowth(1.3, 65)],
  ["Lev 1.5× (ro≥65 & uptrend)",    levGrowth(1.5, 65)],
  ["Lev 1.5× (ro≥60 & uptrend)",    levGrowth(1.5, 60)],
  ["CPPI m4 floor20 cap1.5",        cppi(4, 0.20, 1.5)],
  ["CPPI m5 floor15 cap1.6",        cppi(5, 0.15, 1.6)],
  ...(START >= "2017-01-01" ? [
    ["Growth + 5% BTC",             withBtc(stepGrowth, 0.05)],
    ["Lev1.5 + 5% BTC",             withBtc(levGrowth(1.5, 60), 0.05)],
    ["Lev1.5 + 10% BTC",            withBtc(levGrowth(1.5, 60), 0.10)],
  ] : []),
];

const results = {};
console.log(`\n  ${"strategy".padEnd(30)}${"total".padStart(10)}${"CAGR".padStart(8)}${"Sharpe".padStart(8)}${"maxDD".padStart(9)}`);
for (const [name, step] of NAMES) {
  const r = await runStrategy(step);
  results[name] = r;
  console.log(`  ${name.padEnd(30)}${((r.total >= 0 ? "+" : "") + r.total.toFixed(0) + "%").padStart(10)}${(r.cagr.toFixed(1) + "%").padStart(8)}${r.sharpe.toFixed(2).padStart(8)}${(r.maxDD.toFixed(1) + "%").padStart(9)}`);
}

const spy = results["SPY buy & hold"];
console.log(`\n  ── Beat SPY (+${spy.total.toFixed(0)}% · ${spy.maxDD.toFixed(0)}% DD) on total return WITH lower drawdown? ──`);
for (const [name] of NAMES.slice(3)) {
  const r = results[name]; const beatsRet = r.total > spy.total, lowerDD = r.maxDD > spy.maxDD;
  console.log(`  ${beatsRet && lowerDD ? "✓ PASS" : (beatsRet ? "~ ret only" : "✗     ")} ${name.padEnd(28)} ret ${(r.total - spy.total >= 0 ? "+" : "")}${(r.total - spy.total).toFixed(0)}pp · DD ${r.maxDD.toFixed(1)}% vs ${spy.maxDD.toFixed(1)}% · Sharpe ${r.sharpe.toFixed(2)} vs ${spy.sharpe.toFixed(2)}`);
}

const canonical = process.env.BT_START ? `beat_index_lab_${START}.json` : "beat_index_lab.json";
writeFileSync(join(OUT, canonical), JSON.stringify({ generatedAt: new Date().toISOString(), window: { start: START }, months: dates.length, results }, null, 2));
console.log(`\n  → wrote research/out/${canonical}\n`);
