// ─────────────────────────────────────────────────────────────────────────────
// WALK-FORWARD harness (Phase 1) — anti-overfit rigor. Rolling train→embargo→test
// windows (López de Prado): a parameter is chosen on each TRAIN window by in-sample
// Sharpe, then applied to the next TEST window; an embargo gap between them prevents
// the 12-1m momentum lookback from leaking training data into the test. OOS returns
// are stitched across all test windows and compared to (a) each fixed parameter over
// the full period and (b) the best-in-hindsight parameter — so the OVERFIT GAP
// (in-sample-optimal minus out-of-sample-realized) is visible, not assumed.
//
// Demonstrated on the validated edge from Phase 0B: the multi-asset dual-momentum
// sleeve, tuning its absolute-momentum LOOKBACK. This both proves the framework and
// answers a real Phase-2 question: does picking "the best" lookback in-sample help OOS,
// or should we fix a sensible default? Regime-free → trustworthy over the full history.
// Run: PX_FROM=2006-01-01 node --experimental-strip-types research/walkforward.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { fwdReturn } from "./prices.mjs";
import { ASSETS, applyDualMomentum } from "./allocate.mjs";

const START = process.env.BT_START || "2007-07-01";
const COST_BPS = 10;
const TRAIN = 48, EMBARGO = 2, TEST = 12; // months
const LOOKBACKS = [3, 6, 9, 12, 15, 18];   // candidate absolute-momentum lookbacks

const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const sharpe = (a) => (std(a) ? mean(a) / std(a) * Math.sqrt(12) : null);
const pct = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);
function ddOf(rets) { let eq = 1, peak = 1, dd = 0; for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); } return dd * 100; }
function totOf(rets) { let eq = 1; for (const r of rets) eq *= 1 + r / 100; return (eq - 1) * 100; }

const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));

console.log(`\n  SCORA walk-forward · dual-momentum lookback · ${dates.length} months ${dates[0]}→${dates.at(-1)}`);
console.log(`  train ${TRAIN}m · embargo ${EMBARGO}m · test ${TEST}m · lookbacks {${LOOKBACKS.join(",")}}\n  loading prices…`);

// Precompute the net monthly return of the dual-momentum sleeve for EACH lookback,
// aligned to `dates`. base = equal-weight risk assets; gate by L-1 month momentum.
const fwd1 = new Map();
async function f1(a, d) { const k = `${a}/${d}`; if (!fwd1.has(k)) fwd1.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fwd1.get(k); }
const BASE = { SPY: 0.2, TLT: 0.2, IEF: 0.2, GLD: 0.2, DBC: 0.2 };

async function retsForLookback(L) {
  const rets = []; let prev = {};
  for (const date of dates) {
    const mom = {};
    for (const a of ASSETS) mom[a] = await fwdReturn(a, addMonths(date, -L), addMonths(date, -1));
    const w = applyDualMomentum(BASE, mom).weights;
    let gross = 0; for (const a of ASSETS) { const wa = w[a] || 0; if (!wa) continue; const r = await f1(a, date); if (r != null) gross += wa * r; }
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    rets.push(gross - (turn / 2) * 2 * COST_BPS / 100); prev = w;
  }
  return rets;
}

const byL = {};
for (const L of LOOKBACKS) byL[L] = await retsForLookback(L);

// Walk-forward: for each test block, pick the lookback with best TRAIN Sharpe, apply OOS.
const oos = []; const picks = [];
let testStart = TRAIN + EMBARGO;
while (testStart < dates.length) {
  const trS = testStart - EMBARGO - TRAIN, trE = testStart - EMBARGO; // train window [trS,trE)
  let bestL = LOOKBACKS[0], bestS = -Infinity;
  for (const L of LOOKBACKS) { const s = sharpe(byL[L].slice(trS, trE)); if (s != null && s > bestS) { bestS = s; bestL = L; } }
  const teE = Math.min(testStart + TEST, dates.length);
  for (let i = testStart; i < teE; i++) oos.push(byL[bestL][i]);
  picks.push({ at: dates[testStart], L: bestL, trainSharpe: bestS });
  testStart += TEST;
}

// Report
console.log("\n  ── each fixed lookback, full period ──");
console.log("  lookback   return   Sharpe   maxDD");
for (const L of LOOKBACKS) { const r = byL[L]; console.log(`  ${(L + "m").padEnd(9)} ${pct(totOf(r)).padStart(7)}%  ${sharpe(r).toFixed(2).padStart(6)}  ${pct(ddOf(r)).padStart(6)}%`); }
const bestFixed = LOOKBACKS.reduce((b, L) => (sharpe(byL[L]) > sharpe(byL[b]) ? L : b), LOOKBACKS[0]);

// OOS window aligns to the same tail for a fair fixed-vs-OOS comparison
const tail = dates.length - oos.length;
const fixedTail = (L) => byL[L].slice(tail);
console.log("\n  ── walk-forward (out-of-sample, selected each block by train Sharpe) ──");
console.log(`  OOS months: ${oos.length} (${dates[tail]}→${dates.at(-1)})`);
console.log(`  WF-selected     ${pct(totOf(oos)).padStart(7)}%  Sharpe ${sharpe(oos).toFixed(2)}  maxDD ${pct(ddOf(oos))}%`);
console.log(`  best-fixed (${bestFixed}m, hindsight, same window) ${pct(totOf(fixedTail(bestFixed))).padStart(7)}%  Sharpe ${sharpe(fixedTail(bestFixed)).toFixed(2)}  maxDD ${pct(ddOf(fixedTail(bestFixed)))}%`);
const overfitGap = sharpe(fixedTail(bestFixed)) - sharpe(oos);
console.log(`\n  Overfit gap (best-in-hindsight − WF-selected Sharpe): ${overfitGap >= 0 ? "+" : ""}${overfitGap.toFixed(2)}`);
console.log("  lookback picks over time:", picks.map((p) => `${p.at.slice(0, 7)}:${p.L}m`).join("  "));
const verdict = sharpe(oos) != null && sharpe(oos) > 0.5
  ? `Framework OK. WF-selected OOS Sharpe ${sharpe(oos).toFixed(2)} ${overfitGap > 0.15 ? "trails best-in-hindsight → in-sample selection overfits; prefer a fixed default lookback." : "≈ best-in-hindsight → selection is stable; lookback choice is not fragile."}`
  : "WF-selected OOS weak — revisit.";
console.log(`\n  Verdict: ${verdict}\n`);
