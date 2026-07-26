// ─────────────────────────────────────────────────────────────────────────────
// ALLOCATOR LAB (Fase 8, Step 6) — test the course-derived allocation policies against the
// production Growth default (C3): CPPI, risk-parity (inverse-vol), volatility targeting, and
// constant-mix 60/40. Same free ETF universe + regime + absolute-momentum gate + riskReport as
// capture_lab.mjs (one code path). Honest test: does any policy beat C3 risk-adjusted?
//   node --experimental-strip-types --no-warnings research/allocator_lab.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { ASSETS, growthWeights, applyDualMomentum } from "./allocate.mjs";
import { riskReport } from "../lib/riskMetrics.ts";

const COST_BPS = 10;
const START = process.env.BT_START || "2007-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));
console.log(`\n  ALLOCATOR LAB · ${dates.length} rebalances ${dates[0]}→${dates.at(-1)} · CPPI / risk-parity / vol-target / 60-40 vs C3`);
await preloadStationary();

const fCache = new Map();
async function fwd1(a, d) { const k = a + d; if (!fCache.has(k)) fCache.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fCache.get(k); }
async function mom(a, d) { return fwdReturn(a, addMonths(d, -12), addMonths(d, -1)); }
const std = (a) => { if (a.length < 2) return 0; const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
// Trailing annualized vol (decimal) from the prior `months` monthly returns ending at `date`.
async function trailVol(a, date, months = 12) {
  const r = [];
  for (let k = months; k >= 1; k--) { const v = await fwd1(a, addMonths(date, -k)); if (v != null) r.push(v / 100); }
  return r.length >= 6 ? std(r) * Math.sqrt(12) : null;
}
async function gate(base, date) { const m = {}; for (const a of ASSETS) m[a] = await mom(a, date); return applyDualMomentum(base, m).weights; }

// Stateless-policy runner (weights from date+macro).
async function run(step) {
  const rets = []; let prev = {};
  for (const date of dates) {
    const macro = await regimeStationaryAsOf(date);
    const w = await step(date, macro);
    let gross = 0; for (const a of ASSETS) { const wa = w[a] || 0; if (!wa) continue; const r = await fwd1(a, date); if (r == null) continue; gross += wa * r; }
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    rets.push(gross - (turn / 2) * 2 * COST_BPS / 100); prev = w;
  }
  return rets;
}

// ── Policies ─────────────────────────────────────────────────────────────────
const stepSPY = async () => ({ SPY: 1 });
const stepGrowth = async (date, macro) => { const b = await mom("BTCUSD", date); return gate(growthWeights(macro.risk_on, b), date); }; // C3 production
const stepConstMix = async () => ({ SPY: 0.6, IEF: 0.4 });   // constant-mix 60/40, rebalanced monthly

// Risk parity (inverse-vol) across SPY/TLT/GLD, gated by absolute momentum.
const RP = ["SPY", "TLT", "GLD"];
const stepRiskParity = async (date) => {
  const inv = {}; let sum = 0;
  for (const a of RP) { const v = await trailVol(a, date); const iv = v && v > 0 ? 1 / v : 0; inv[a] = iv; sum += iv; }
  const base = {}; for (const a of RP) base[a] = sum > 0 ? inv[a] / sum : 1 / RP.length;
  return gate(base, date);
};

// Vol targeting: scale SPY exposure so trailing portfolio vol ≈ TARGET, rest to cash. Gated.
const VOL_TARGET = 0.12;
const stepVolTarget = async (date) => {
  const v = await trailVol("SPY", date);
  const eW = v && v > 0 ? Math.max(0, Math.min(1, VOL_TARGET / v)) : 1;
  return gate({ SPY: eW, BIL: 1 - eW }, date);
};

// CPPI (path-dependent): floor grows at cash; equity = clamp(m·cushion/NAV). Self-derisking →
// no momentum gate. m=3, initial floor = 80% of NAV.
async function runCPPI(m = 3, floor0 = 0.8) {
  const rets = []; let prev = {}; let nav = 1, floor = floor0;
  for (const date of dates) {
    const cushion = Math.max(0, nav - floor);
    const eW = Math.max(0, Math.min(1, (m * cushion) / nav));
    const w = { SPY: eW, BIL: 1 - eW };
    let gross = 0; for (const a of ASSETS) { const wa = w[a] || 0; if (!wa) continue; const r = await fwd1(a, date); if (r == null) continue; gross += wa * r; }
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    const ret = gross - (turn / 2) * 2 * COST_BPS / 100;
    rets.push(ret); prev = w; nav *= 1 + ret / 100;
    const bil = (await fwd1("BIL", date)) ?? 0; floor *= 1 + bil / 100; // floor accretes at cash
  }
  return rets;
}

// ── Run + report ───────────────────────────────────────────────────────────────
const spyR = await run(stepSPY);
const tot = (r) => { let e = 1; for (const x of r) e *= 1 + x / 100; return (e - 1) * 100; };
const policies = [
  ["SPY buy & hold", await run(stepSPY)],
  ["C3 Growth (production)", await run(stepGrowth)],
  ["Risk parity (inv-vol)", await run(stepRiskParity)],
  ["Vol target 12%", await run(stepVolTarget)],
  ["CPPI m=3 floor80", await runCPPI(3, 0.8)],
  ["Constant-mix 60/40", await run(stepConstMix)],
];

const out = { generatedAt: new Date().toISOString(), months: dates.length, window: { start: START }, results: {} };
console.log(`\n  ${"policy".padEnd(26)}${"total".padStart(9)}${"CAGR".padStart(7)}${"Sharpe".padStart(8)}${"Sortino".padStart(9)}${"Calmar".padStart(8)}${"maxDD".padStart(8)}${"beta".padStart(7)}${"α".padStart(7)}`);
for (const [name, r] of policies) {
  const rep = riskReport(r, spyR);
  const total = tot(r);
  out.results[name] = { total: +total.toFixed(1), cagr: rep.cagr, sharpe: rep.sharpe, sortino: rep.sortino, calmar: rep.calmar, maxDrawdown: rep.maxDrawdown, beta: rep.beta, alpha: rep.alpha, informationRatio: rep.informationRatio };
  console.log(`  ${name.padEnd(26)}${("+" + total.toFixed(0) + "%").padStart(9)}${(rep.cagr + "%").padStart(7)}${String(rep.sharpe).padStart(8)}${String(rep.sortino).padStart(9)}${String(rep.calmar).padStart(8)}${(rep.maxDrawdown + "%").padStart(8)}${String(rep.beta ?? "—").padStart(7)}${String(rep.alpha ?? "—").padStart(7)}`);
}
const c3 = out.results["C3 Growth (production)"];
const beatsC3 = Object.entries(out.results).filter(([n, r]) => n !== "SPY buy & hold" && n !== "C3 Growth (production)" && r.sharpe > c3.sharpe && r.maxDrawdown >= c3.maxDrawdown);
out.verdict = beatsC3.length ? `A policy beats C3 risk-adjusted: ${beatsC3.map(([n]) => n).join("; ")}. Consider it (validate OOS before shipping).` : `NONE beats C3 on Sharpe with an equal-or-smaller drawdown — C3 stays the default (honest: the course policies don't add here).`;
console.log(`\n  VERDICT: ${out.verdict}`);
writeFileSync(join(OUT, "allocator_lab.json"), JSON.stringify(out, null, 2));
console.log(`  → wrote research/out/allocator_lab.json\n`);
