// ─────────────────────────────────────────────────────────────────────────────
// AGGRESSIVE LAB (2026-07-10) — the user's brief: BEAT SPY's total return WITH a
// smaller drawdown. The shipped allocator (risk-on blend capped at 55% equity +
// risk-parity) maximizes Sharpe at a ~5% vol budget → +153% in 19.5y: honest, but
// commercially indefensible vs SPY's +652%. This lab raises the RISK BUDGET while
// keeping the validated regime signal, and measures every variant against SPY and
// the static 60/40 on the same engine (monthly, net of 10bp/side, stationary regime).
// Variants:
//   AGG-blend   : risk-on gauge blends {SPY 100%} ←→ defensive basket, + 12-1m gate
//   AGG-switch  : binary — gauge ≥50 → 100% SPY, else defensive basket, + gate
//   AGG-qqq     : AGG-blend with QQQ (flagged: single-index concentration risk)
//   GEM top-1   : classic dual momentum — hold the top 12-1m asset of [SPY,GLD,TLT]
//                 if its momentum >0, else BIL (no regime needed — robustness control)
//   GEM-regime  : GEM, but risk-off gauge (<40) forces the defensive pick set [GLD,TLT]
// Run: REGIME ignored (always stationary) ·
//   node --experimental-strip-types --no-warnings research/aggressive_lab.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn, returnsSeries } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { applyDualMomentum } from "./allocate.mjs";

const COST_BPS = 10;
const START = process.env.BT_START || "2007-01-01";
const END = process.env.BT_END || null; // e.g. 2019-12-01 for the pre-2020 OOS window
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// SSO (2× SPY, 2006) and SH (inverse SPY, 2006) cover the full window. VXX (long VIX
// futures) only trades from 2009 → VIX strategies are only honest from BT_START≥2010.
const ASSETS = ["SPY", "QQQ", "SSO", "SH", "VXX", "TLT", "IEF", "GLD", "DBC", "BIL"];
const OFF = { SPY: 0.15, TLT: 0.25, IEF: 0.20, GLD: 0.20, DBC: 0.05, BIL: 0.15 };

const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, END ?? addMonths(today, -1));
console.log(`\n  AGGRESSIVE LAB · ${dates.length} monthly rebalances ${dates[0]}→${dates.at(-1)} · stationary regime\n  loading regime + prices…`);
await preloadStationary();

const fCache = new Map();
async function fwd1(asset, date) { const k = `${asset}/${date}`; if (!fCache.has(k)) fCache.set(k, await fwdReturn(asset, date, addMonths(date, 1))); return fCache.get(k); }
async function mom12_1(asset, date) { return fwdReturn(asset, addMonths(date, -12), addMonths(date, -1)); }

async function runStrategy(step) {
  let eq = 1, peak = 1, maxDD = 0; const rets = []; let prev = {};
  for (const date of dates) {
    const macro = await regimeStationaryAsOf(date);
    const w = await step(date, macro);
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

const blend = (onBasket, t) => { const w = {}; for (const a of new Set([...Object.keys(onBasket), ...Object.keys(OFF)])) w[a] = t * (onBasket[a] || 0) + (1 - t) * (OFF[a] || 0); return w; };
async function gated(w, date) { const mom = {}; for (const a of ["SPY", "QQQ", "TLT", "GLD", "DBC"]) if (w[a]) mom[a] = await mom12_1(a, date); return applyDualMomentum(w, mom).weights; }

// ── Variants ──────────────────────────────────────────────────────────────────
const stepAggBlend  = async (date, m) => gated(blend({ SPY: 1 }, Math.max(0, Math.min(1, (m.risk_on ?? 50) / 100))), date);
const stepAggSwitch = async (date, m) => gated((m.risk_on ?? 50) >= 50 ? { SPY: 1 } : { ...OFF }, date);
const stepAggQqq    = async (date, m) => gated(blend({ QQQ: 1 }, Math.max(0, Math.min(1, (m.risk_on ?? 50) / 100))), date);
const gem = (picks) => async (date) => {
  let best = null, bestM = null;
  for (const a of picks) { const mm = await mom12_1(a, date); if (mm != null && (bestM == null || mm > bestM)) { best = a; bestM = mm; } }
  return best != null && bestM > 0 ? { [best]: 1 } : { BIL: 1 };
};
const stepGem = gem(["SPY", "GLD", "TLT"]);
const stepGemRegime = async (date, m) => {
  const ro = m.risk_on ?? 50;
  return (ro < 40 ? gem(["GLD", "TLT"]) : gem(["SPY", "GLD", "TLT"]))(date, m);
};
const stepSPY = async () => ({ SPY: 1 });
const step6040 = async () => ({ SPY: 0.6, IEF: 0.4 });

// ── Leverage & non-long-only variants ─────────────────────────────────────────
// SPY trailing 63d realized vol (annualized %), for vol targeting.
const volCache = new Map();
async function spyVol(date) {
  if (volCache.has(date)) return volCache.get(date);
  const r = await returnsSeries("SPY");
  let hi = -1; for (let i = 0; i < r.length; i++) { if (r[i].date <= date) hi = i; else break; }
  let v = null;
  if (hi >= 63) { const w = r.slice(hi - 62, hi + 1).map((x) => x.ret); const m = mean(w); v = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / (w.length - 1)) * Math.sqrt(252); }
  volCache.set(date, v); return v;
}
// Express an equity exposure w∈[0,2] with SPY+SSO (SSO≈2×): exposure = spy + 2·sso.
const equityAt = (w, rest = {}) => w <= 1 ? { SPY: w, BIL: Math.max(0, 1 - w - Object.values(rest).reduce((s, x) => s + x, 0)), ...rest } : { SPY: 2 - w, SSO: w - 1, ...rest };

// LEV-switch: the Growth switch, but risk-on ≥60 takes 2× (SSO). Regime-budgeted leverage.
const stepLevSwitch = async (date, m) => {
  const ro = m.risk_on ?? 50;
  const spyMom = await mom12_1("SPY", date);
  if (spyMom != null && spyMom <= 0) return { ...OFF };            // trend gate
  if (ro >= 60) return { SSO: 1 };
  if (ro >= 50) return { SPY: 1 };
  return { ...OFF };
};
// VT: vol-target 15% on the equity sleeve (0.3–2.0× via SPY/SSO), regime-gated to defensive.
const stepVolTarget = async (date, m) => {
  const ro = m.risk_on ?? 50;
  if (ro < 40) return { ...OFF };
  const v = await spyVol(date);
  const spyMom = await mom12_1("SPY", date);
  if (spyMom != null && spyMom <= 0) return { ...OFF };
  const w = v != null && v > 0 ? Math.max(0.3, Math.min(2, 15 / v)) : 1;
  return equityAt(w);
};
// HEDGE-short: never sells the equity — risk-off ADDS a short overlay (SH) instead.
const stepHedgeShort = async (date, m) => {
  const ro = m.risk_on ?? 50;
  return ro < 40 ? { SPY: 0.7, SH: 0.3 } : { SPY: 1 };
};
// VIX-static: the textbook tail hedge — 95/5 SPY/VXX, always on (measures the contango bleed).
const stepVixStatic = async () => ({ SPY: 0.95, VXX: 0.05 });
// VIX-timed: long vol ONLY when the gauge is risk-off (the "buy protection when it matters" pitch).
const stepVixTimed = async (date, m) => {
  const ro = m.risk_on ?? 50;
  return ro < 40 ? { SPY: 0.85, VXX: 0.15 } : { SPY: 1 };
};

const VIX_OK = START >= "2010-01-01"; // VXX has no data before 2009 — don't fake it
const NAMES = [
  ["SPY buy & hold",            stepSPY],
  ["Static 60/40",              step6040],
  ["AGG-blend  (0-100% SPY)",   stepAggBlend],
  ["AGG-switch (binary)",       stepAggSwitch],
  ["AGG-qqq    (0-100% QQQ)",   stepAggQqq],
  ["GEM top-1  (SPY/GLD/TLT)",  stepGem],
  ["GEM-regime (risk-off→def)", stepGemRegime],
  ["LEV-switch (2× if ro≥60)",  stepLevSwitch],
  ["VOL-target 15% (0.3-2×)",   stepVolTarget],
  ["HEDGE-short (SPY+SH)",      stepHedgeShort],
  ...(VIX_OK ? [
    ["VIX-static 95/5 (bleed)",  stepVixStatic],
    ["VIX-timed  (ro<40→15%)",   stepVixTimed],
  ] : []),
];

const results = {};
console.log(`\n  ${"strategy".padEnd(28)}${"total".padStart(9)}${"CAGR".padStart(8)}${"Sharpe".padStart(8)}${"maxDD".padStart(9)}`);
for (const [name, step] of NAMES) {
  const r = await runStrategy(step);
  results[name] = r;
  console.log(`  ${name.padEnd(28)}${(r.total >= 0 ? "+" : "") + r.total.toFixed(1) + "%"}`.padEnd(38) + `${r.cagr.toFixed(1)}%`.padStart(7) + `${r.sharpe?.toFixed(2)}`.padStart(8) + `${r.maxDD.toFixed(1)}%`.padStart(9));
}

const spy = results["SPY buy & hold"];
console.log(`\n  ── The brief: beat SPY's total (+${spy.total.toFixed(0)}%) with a smaller drawdown (${spy.maxDD.toFixed(0)}%) ──`);
for (const [name] of NAMES.slice(2)) {
  const r = results[name];
  const beats = r.total > spy.total && r.maxDD > spy.maxDD;
  console.log(`  ${beats ? "✓ PASS" : "✗     "} ${name} — ${r.total > spy.total ? "beats" : "trails"} on return (${(r.total - spy.total >= 0 ? "+" : "")}${(r.total - spy.total).toFixed(0)}pp), DD ${r.maxDD.toFixed(1)}% vs ${spy.maxDD.toFixed(1)}%`);
}

// Canonical artifact (the one the golden anti-drift check reads) = the DEFAULT full
// window only; sub-window runs (BT_START/BT_END) write a suffixed file so a robustness
// check can never masquerade as the headline measurement.
const canonical = !process.env.BT_START && !process.env.BT_END;
const fname = canonical ? "aggressive_lab.json" : `aggressive_lab_${START}_${END ?? "now"}.json`;
writeFileSync(join(OUT, fname), JSON.stringify({ generatedAt: new Date().toISOString(), window: { start: START, end: END ?? "latest" }, months: dates.length, results }, null, 2));
console.log(`\n  → wrote research/out/${fname}\n`);
