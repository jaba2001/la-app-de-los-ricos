// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 validation — sector/factor rotation. Each month, rank the 11 SPDR sector
// ETFs by 12-1m absolute momentum, hold the top-K equal-weight, and gate each slot to
// cash (BIL) if its own momentum is ≤ 0 (Antonacci dual momentum). Measures vs SPY and
// vs an equal-weight-all-sectors basket over 2007-2026. Newer sectors (XLRE 2015, XLC
// 2018) simply aren't ranked before they exist — the engine ranks whatever has history.
// Run: PX_FROM=2006-01-01 node --experimental-strip-types research/sectors.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { fwdReturn } from "./prices.mjs";

const SECTORS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLP", "XLY", "XLB", "XLU", "XLRE", "XLC"];
const TOPK = 3, COST_BPS = 10;
const START = process.env.BT_START || "2007-07-01";

const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const pct = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);
const sharpe = (a) => (std(a) ? mean(a) / std(a) * Math.sqrt(12) : null);
function ddOf(rets) { let eq = 1, peak = 1, dd = 0; for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); } return dd * 100; }
function totOf(rets) { let eq = 1; for (const r of rets) eq *= 1 + r / 100; return (eq - 1) * 100; }

const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));
console.log(`\n  LAYER 3 · sector rotation · top-${TOPK} by 12-1m momentum · ${dates.length} months ${dates[0]}→${dates.at(-1)}\n  loading sector ETFs…`);

const f1 = new Map();
async function fwd1(a, d) { const k = `${a}/${d}`; if (!f1.has(k)) f1.set(k, await fwdReturn(a, d, addMonths(d, 1))); return f1.get(k); }

async function run(step) {
  const rets = []; let prev = {};
  for (const date of dates) {
    const w = await step(date);
    let gross = 0, wsum = 0;
    for (const a of Object.keys(w)) { const wa = w[a]; if (!wa) continue; const r = a === "BIL" ? await fwd1("BIL", date) : await fwd1(a, date); if (r != null) { gross += wa * r; wsum += wa; } }
    let turn = 0; const keys = new Set([...Object.keys(w), ...Object.keys(prev)]);
    for (const a of keys) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    rets.push(gross - (turn / 2) * 2 * COST_BPS / 100); prev = w;
  }
  return rets;
}

// rotation: rank available sectors by 12-1m momentum, top-K equal-weight, cash-gate weak ones
const stepRotation = async (date) => {
  const moms = [];
  for (const s of SECTORS) { const m = await fwdReturn(s, addMonths(date, -12), addMonths(date, -1)); if (m != null) moms.push([s, m]); }
  if (moms.length < TOPK) return { BIL: 1 };
  moms.sort((a, b) => b[1] - a[1]);
  const top = moms.slice(0, TOPK);
  const w = {}; const slot = 1 / TOPK;
  for (const [s, m] of top) { if (m > 0) w[s] = (w[s] || 0) + slot; else w.BIL = (w.BIL || 0) + slot; }
  return w;
};
// equal-weight all available sectors (rotation control)
const stepEqual = async (date) => {
  const avail = [];
  for (const s of SECTORS) { const m = await fwdReturn(s, addMonths(date, -12), addMonths(date, -1)); if (m != null) avail.push(s); }
  const w = {}; for (const s of avail) w[s] = 1 / avail.length; return w;
};
const stepSPY = async () => ({ SPY: 1 });

const [rot, eq, spy] = [await run(stepRotation), await run(stepEqual), await run(stepSPY)];
const line = (name, r) => `  ${name.padEnd(24)} ${pct(totOf(r)).padStart(7)}%   Sharpe ${sharpe(r).toFixed(2)}   maxDD ${pct(ddOf(r)).padStart(6)}%`;
console.log(`\n  ── ${dates.length}-month curves (net of ${COST_BPS}bps/side) ──`);
console.log(line(`Sector rotation (top-${TOPK})`, rot));
console.log(line("Equal-weight sectors", eq));
console.log(line("SPY buy & hold", spy));

// sub-period + current top sectors
const splitIdx = dates.findIndex((d) => d >= "2020-01-01");
if (splitIdx > 6) {
  const sub = (r, a, b) => { const s = r.slice(a, b); return `${pct(totOf(s)).padStart(7)}% / ${sharpe(s).toFixed(2)} / ${pct(ddOf(s))}%`; };
  console.log("\n  ── sub-period (rotation / SPY) ──");
  console.log(`  pre-2020  ${sub(rot, 0, splitIdx)}   |  SPY ${sub(spy, 0, splitIdx)}`);
  console.log(`  2020-26   ${sub(rot, splitIdx, dates.length)}   |  SPY ${sub(spy, splitIdx, dates.length)}`);
}
const last = dates.at(-1);
const cur = [];
for (const s of SECTORS) { const m = await fwdReturn(s, addMonths(last, -12), addMonths(last, -1)); if (m != null) cur.push([s, m]); }
cur.sort((a, b) => b[1] - a[1]);
console.log(`\n  Current 12-1m momentum ranking (${last}):`);
console.log("  " + cur.map(([s, m]) => `${s} ${pct(m, 0)}%`).join(" · "));

const rotSh = sharpe(rot), spySh = sharpe(spy);
console.log(`\n  Verdict: ${rotSh > spySh + 0.1 ? `PASS — sector rotation Sharpe ${rotSh.toFixed(2)} vs SPY ${spySh.toFixed(2)}: Layer 3 adds value.` : `WEAK — rotation Sharpe ${rotSh.toFixed(2)} vs SPY ${spySh.toFixed(2)}; marginal.`}\n`);
