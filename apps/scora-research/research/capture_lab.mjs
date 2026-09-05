// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE LAB (2026-07-12) — the honest test of the user's hypothesis: the production
// Growth profile is tuned for MINIMUM DRAWDOWN (beta ~0.32), which is precisely why it
// can't out-return a bull market. Here we retune for CAPTURE: stay invested, keep beta
// HIGH, and use the regime + absolute-momentum signal ONLY to sidestep the deepest tail
// events — not to de-risk constantly. Question: can a higher-beta variant match/beat SPY
// TOTAL RETURN while still cutting the drawdown meaningfully? Measure, don't assert.
// Same engine as growth_metrics.mjs (one code path: prices/regime/riskReport). Run:
//   node --experimental-strip-types --no-warnings research/capture_lab.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { ASSETS, growthWeights, applyDualMomentum, BTC_SLEEVE } from "./allocate.mjs";
import { riskReport } from "../lib/riskMetrics.ts";

const COST_BPS = 10;
const START = process.env.BT_START || "2007-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));
console.log(`\n  CAPTURE LAB · ${dates.length} monthly rebalances ${dates[0]}→${dates.at(-1)} · high-beta variants vs SPY & production Growth`);
await preloadStationary();

const fCache = new Map();
async function fwd1(a, d) { const k = a + d; if (!fCache.has(k)) fCache.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fCache.get(k); }
async function mom(a, d) { return fwdReturn(a, addMonths(d, -12), addMonths(d, -1)); }

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

// Deep-risk-off defensive basket (only deployed on the strongest risk-off signal / tail).
const DEF = { SPY: 0, TLT: 0.35, IEF: 0.25, GLD: 0.25, DBC: 0, BIL: 0.15, BTCUSD: 0 };
// Helper: apply the absolute-momentum tail gate (SPY/TLT/GLD/DBC → BIL when 12-1m ≤ 0).
async function gate(base, date) { const m = {}; for (const a of ASSETS) m[a] = await mom(a, date); return applyDualMomentum(base, m).weights; }
// Optional 5% BTC sleeve carved from SPY when risk-on & BTC trend up (never leverage).
async function withBtc(base, date) { const b = await mom("BTCUSD", date); if (b != null && b > 0 && (base.SPY || 0) >= BTC_SLEEVE) { return { ...base, SPY: base.SPY - BTC_SLEEVE, BTCUSD: BTC_SLEEVE }; } return base; }

// ── Anchors ──────────────────────────────────────────────────────────────────
const stepSPY = async () => ({ SPY: 1 });
const stepGrowth = async (date, macro) => { const b = await mom("BTCUSD", date); return gate(growthWeights(macro.risk_on, b), date); }; // production

// ── CAPTURE VARIANTS ───────────────────────────────────────────────────────────
// C1 "Trend-only": always fully in SPY; the ONLY exit is the 12-1m absolute-momentum
// tail gate (→ cash in sustained downtrends: 2008, 2022). Regime is ignored → highest beta.
const stepTrend = async (date) => gate({ SPY: 1 }, date);
// C2 "Tail-cut regime": full SPY UNLESS deep risk-off (risk_on < 25 = contraction/crisis),
// then the defensive basket. Captures all normal upside, defends only true tails. + trend gate.
const stepTailCut = async (date, macro) => gate(macro.risk_on < 25 ? { ...DEF } : { SPY: 1 }, date);
// C3 "High floor": risk-on → 100% SPY; risk-off → SPY floor 0.60 + light defensive. + gate.
const stepFloor60 = async (date, macro) => gate(macro.risk_on >= 50 ? { SPY: 1 } : { SPY: 0.6, TLT: 0.15, IEF: 0.1, GLD: 0.15 }, date);
// C4 "Linear scale": SPY weight scales 0.5→1.0 with risk_on; remainder to defensive. + gate.
const stepLinear = async (date, macro) => { const t = Math.max(0, Math.min(1, (macro.risk_on ?? 50) / 100)); const spy = 0.5 + 0.5 * t; const rest = 1 - spy; return gate({ SPY: spy, TLT: rest * 0.4, IEF: rest * 0.3, GLD: rest * 0.3 }, date); };
// C2b "Tail-cut + 5% BTC": the winner-candidate with the same BTC sleeve as production Growth.
const stepTailCutBtc = async (date, macro) => { const base = macro.risk_on < 25 ? { ...DEF } : { SPY: 1 }; return gate(await withBtc(base, date), date); };

const variants = [
  ["SPY buy & hold", stepSPY],
  ["Growth (production, β~0.32)", stepGrowth],
  ["C1 Trend-only (no regime)", stepTrend],
  ["C2 Tail-cut (regime<25)", stepTailCut],
  ["C2b Tail-cut + 5% BTC", stepTailCutBtc],
  ["C3 High-floor 60%", stepFloor60],
  ["C4 Linear scale 50-100%", stepLinear],
];

const spyR = await run(stepSPY);
const tot = (r) => { let e = 1; for (const x of r) e *= 1 + x / 100; return (e - 1) * 100; };
const out = { generatedAt: new Date().toISOString(), months: dates.length, window: { start: START }, results: {} };

console.log(`\n  ${"variant".padEnd(30)}${"total".padStart(9)}${"CAGR".padStart(7)}${"Sharpe".padStart(8)}${"Sortino".padStart(9)}${"maxDD".padStart(8)}${"beta".padStart(7)}${"α".padStart(7)}${"IR".padStart(7)}`);
for (const [name, step] of variants) {
  const r = await run(step);
  const rep = riskReport(r, spyR);
  const total = tot(r);
  out.results[name] = { total: +total.toFixed(1), cagr: rep.cagr, sharpe: rep.sharpe, sortino: rep.sortino, maxDrawdown: rep.maxDrawdown, beta: rep.beta, alpha: rep.alpha, informationRatio: rep.informationRatio, var95: rep.var95, cvar95: rep.cvar95 };
  console.log(`  ${name.padEnd(30)}${("+" + total.toFixed(0) + "%").padStart(9)}${(rep.cagr + "%").padStart(7)}${String(rep.sharpe).padStart(8)}${String(rep.sortino).padStart(9)}${(rep.maxDrawdown + "%").padStart(8)}${String(rep.beta ?? "—").padStart(7)}${String(rep.alpha ?? "—").padStart(7)}${String(rep.informationRatio ?? "—").padStart(7)}`);
}

// Verdict: did any capture variant beat SPY total return AND cut the drawdown?
const spyTotal = tot(spyR), spyDD = riskReport(spyR).maxDrawdown;
const winners = Object.entries(out.results).filter(([n, r]) => n !== "SPY buy & hold" && r.total >= spyTotal && r.maxDrawdown > spyDD);
out.spy = { total: +spyTotal.toFixed(1), maxDrawdown: spyDD };
out.verdict = winners.length ? `BEATABLE — ${winners.map(([n]) => n).join("; ")} matched/beat SPY total return with a smaller drawdown.` : `NOT beaten on total return — but check the risk-adjusted + drawdown tradeoff per variant (the honest sale is still risk-adjusted).`;
console.log(`\n  SPY: +${spyTotal.toFixed(0)}% · maxDD ${spyDD}%`);
console.log(`  VERDICT: ${out.verdict}`);
writeFileSync(join(OUT, "capture_lab.json"), JSON.stringify(out, null, 2));
console.log(`  → wrote research/out/capture_lab.json\n`);
