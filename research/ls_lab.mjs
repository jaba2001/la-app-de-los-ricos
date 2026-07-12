// ─────────────────────────────────────────────────────────────────────────────
// LONG/SHORT LAB (2026-07-12) — the honest test of the user's opening: if we allow
// SHORTS, can we generate real SELECTION ALPHA (not disguised beta)? A dollar-neutral
// 50/50 long/short book (100% gross = 0% net = UNLEVERED in net terms) strips the market
// beta out, so its whole return IS alpha. We test three signals on the SAME point-in-time
// panel: (1) the full Scora score, (2) 12-1m price momentum, (3) momentum GATED by the
// correlation regime (momentum reverses when correlation is high → go flat / invert there).
// Question: does the free-data signal clear a Sharpe worth building a product on, or do we
// need to pay for a higher-IC signal (estimate revisions) to cross the bar?
// Reuses the exact backtest.mjs data path (one code path). Run:
//   node --experimental-strip-types --no-warnings research/ls_lab.mjs --full 250
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, fwdReturn, momentum, hasPriceAt } from "./prices.mjs";
import { regimeAsOf, preloadRegimeSeries } from "./regimeReal.mjs";
import { scoreStock } from "./score.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";
import { buildCorrEngine, corrAsOf } from "./correlation.mjs";
import { riskReport } from "../lib/riskMetrics.ts";

const COST_BPS = 10;               // per side
const FRAC = 0.2;                  // top/bottom quintile per leg (breadth-friendly)
const START = process.env.BT_START || "2020-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));
const FULL = process.argv.includes("--full");
const CAP = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 250);
let UNIVERSE = CURATED;
const memberSet = new Map();
if (FULL) {
  const table = await loadSP500Historical();
  if (table) {
    for (const d of dates) memberSet.set(d, new Set(membersAsOf(table, d)));
    const freq = new Map();
    for (const d of dates) for (const t of memberSet.get(d)) freq.set(t, (freq.get(t) || 0) + 1);
    UNIVERSE = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP).map((e) => e[0]);
  }
}
const isMember = (t, d) => !FULL || (memberSet.get(d)?.has(t) ?? false);
console.log(`\n  LONG/SHORT LAB · ${UNIVERSE.length} names · ${dates.length} months ${dates[0]}→${dates.at(-1)} · dollar-neutral quintile book\n  loading panel…`);

await preloadRegimeSeries();
const meta = {};
for (const t of UNIVERSE) { const cik = await tickerToCik(t); meta[t] = { cik, sector: cik ? await sicSector(cik) : "" }; }

// Panel: per name-month, the full score, 12-1m momentum, and 1M forward return.
const byDate = new Map();
const spyRet = new Map();
for (const date of dates) {
  spyRet.set(date, await fwdReturn("SPY", date, addMonths(date, 1)));
  const macro = await regimeAsOf(date);
  const bucket = [];
  for (const t of UNIVERSE) {
    if (!isMember(t, date)) continue;
    const { cik, sector } = meta[t];
    if (!cik || !(await hasPriceAt(t, date))) continue;
    const f = await fundamentalsAsOf(cik, date);
    const raw = await rawPriceAsOf(t, date);
    if (!f || f.revTTM == null || raw == null) continue;
    const mom = await momentum(t, date);
    const { ic } = scoreStock(f, raw, mom, sector, null); // pure micro score
    const mom121 = await fwdReturn(t, addMonths(date, -12), addMonths(date, -1));
    const fwd1 = await fwdReturn(t, date, addMonths(date, 1));
    if (fwd1 == null) continue;
    bucket.push({ t, score: ic, mom: mom121, fwd1, sector, regime: macro.regime_id });
  }
  byDate.set(date, bucket);
}
const nm = [...byDate.values()].reduce((s, b) => s + b.length, 0);
console.log(`  built ${nm} name-months\n`);

// Correlation regime per date (for the gated momentum variant).
const corrEngine = await buildCorrEngine(UNIVERSE);
const corrByDate = new Map();
for (const d of dates) { const c = corrAsOf(corrEngine, UNIVERSE, d, 63); if (c != null) corrByDate.set(d, c); }
const corrVals = [...corrByDate.values()].sort((a, b) => a - b);
const hiCut = corrVals.length ? corrVals[Math.floor(corrVals.length * 2 / 3)] : Infinity; // top tercile = "high corr"

const spyRets = dates.map((d) => spyRet.get(d)).filter((x) => x != null);
const setNew = (cur, prev) => { let n = 0; for (const x of cur) if (!prev.has(x)) n++; return n; };

// Dollar-neutral 50/50 book (gross 100%, net 0% → unlevered). `signalOf` ranks; long the
// top quintile, short the bottom. `gate`: given the corr reading, return "long" | "flat" |
// "invert" (invert = long losers/short winners, for the high-corr reversal regime).
function lsSeries(signalOf, gate) {
  const rets = []; let prevL = new Set(), prevS = new Set();
  for (const d of dates) {
    const g = (byDate.get(d) || []).filter((r) => signalOf(r) != null && r.fwd1 != null);
    if (g.length < 10) { rets.push(0); prevL = new Set(); prevS = new Set(); continue; }
    const sorted = [...g].sort((a, b) => signalOf(a) - signalOf(b));
    const k = Math.max(1, Math.floor(sorted.length * FRAC));
    let L = sorted.slice(-k), S = sorted.slice(0, k);
    const mode = gate ? gate(corrByDate.get(d)) : "long";
    if (mode === "flat") { rets.push(0); prevL = new Set(); prevS = new Set(); continue; }
    if (mode === "invert") { const t = L; L = S; S = t; }
    const spread = mean(L.map((r) => r.fwd1)) - mean(S.map((r) => r.fwd1));
    const lset = new Set(L.map((r) => r.t)), sset = new Set(S.map((r) => r.t));
    const turnover = (setNew(lset, prevL) + setNew(sset, prevS)) / (lset.size + sset.size);
    // 50/50 book: half the spread, costs on the traded half of each leg (buy+sell).
    rets.push(0.5 * spread - turnover * COST_BPS / 100);
    prevL = lset; prevS = sset;
  }
  return rets;
}
// Long-only top quintile (for context: how much of the return is just the long leg / beta).
function longOnly(signalOf) {
  const rets = [];
  for (const d of dates) {
    const g = (byDate.get(d) || []).filter((r) => signalOf(r) != null && r.fwd1 != null);
    if (g.length < 10) { rets.push(spyRet.get(d) ?? 0); continue; }
    const sorted = [...g].sort((a, b) => signalOf(a) - signalOf(b));
    const k = Math.max(1, Math.floor(sorted.length * FRAC));
    rets.push(mean(sorted.slice(-k).map((r) => r.fwd1)));
  }
  return rets;
}

const tot = (r) => { let e = 1; for (const x of r) e *= 1 + x / 100; return (e - 1) * 100; };
const gateFlat = (c) => (c != null && c >= hiCut ? "flat" : "long");     // sit out the high-corr reversal regime
const gateInvert = (c) => (c != null && c >= hiCut ? "invert" : "long"); // flip to reversal when corr is high

const books = {
  "Full Scora score (L/S)":        lsSeries((r) => r.score, null),
  "12-1m momentum (L/S)":          lsSeries((r) => r.mom, null),
  "Momentum · corr-gated (flat)":  lsSeries((r) => r.mom, gateFlat),
  "Momentum · corr-adaptive (inv)":lsSeries((r) => r.mom, gateInvert),
  "Momentum LONG-ONLY (context)":  longOnly((r) => r.mom),
  "Full-score LONG-ONLY (context)":longOnly((r) => r.score),
};

const out = { generatedAt: new Date().toISOString(), universe: UNIVERSE.length, months: dates.length, nameMonths: nm, frac: FRAC, window: { start: START }, hiCorrCut: hiCut, results: {} };
console.log(`  ${"book".padEnd(32)}${"total".padStart(9)}${"ann.ret".padStart(9)}${"Sharpe".padStart(8)}${"Sortino".padStart(9)}${"maxDD".padStart(8)}${"beta".padStart(7)}`);
for (const [name, r] of Object.entries(books)) {
  const rep = riskReport(r, spyRets);
  const total = tot(r);
  const annRet = (Math.pow(1 + total / 100, 12 / r.length) - 1) * 100;
  out.results[name] = { total: +total.toFixed(1), annRet: +annRet.toFixed(2), sharpe: rep.sharpe, sortino: rep.sortino, maxDrawdown: rep.maxDrawdown, beta: rep.beta };
  console.log(`  ${name.padEnd(32)}${("+" + total.toFixed(0) + "%").padStart(9)}${(annRet.toFixed(1) + "%").padStart(9)}${String(rep.sharpe).padStart(8)}${String(rep.sortino).padStart(9)}${(rep.maxDrawdown + "%").padStart(8)}${String(rep.beta ?? "—").padStart(7)}`);
}
const spyRep = riskReport(spyRets);
console.log(`  ${"SPY (beta reference)".padEnd(32)}${("+" + tot(spyRets).toFixed(0) + "%").padStart(9)}${"".padStart(9)}${String(spyRep.sharpe).padStart(8)}${String(spyRep.sortino).padStart(9)}${(spyRep.maxDrawdown + "%").padStart(8)}${"1.00".padStart(7)}`);

// Verdict: is any market-neutral book's Sharpe worth building on? A dollar-neutral book's
// Sharpe IS its information ratio (benchmark ≈ cash). Bar: Sharpe ≳ 0.5 with beta ≈ 0.
const best = Object.entries(out.results).filter(([n]) => n.includes("L/S")).sort((a, b) => (b[1].sharpe ?? -9) - (a[1].sharpe ?? -9))[0];
out.verdict = best && best[1].sharpe >= 0.5 && Math.abs(best[1].beta ?? 1) < 0.3
  ? `ALPHA on free data — "${best[0]}" earns Sharpe ${best[1].sharpe} at beta ${best[1].beta} (market-neutral). Worth prototyping as a product; paying for estimate revisions would lift it further.`
  : `NOT enough on free data — best market-neutral book "${best?.[0]}" Sharpe ${best?.[1].sharpe} (beta ${best?.[1].beta}) is below the ~0.5 bar. The free momentum signal alone doesn't clear it; a higher-IC paid signal (estimate revisions) is likely required.`;
out.best = best ? { name: best[0], ...best[1] } : null;
console.log(`\n  VERDICT: ${out.verdict}`);
writeFileSync(join(OUT, "ls_lab.json"), JSON.stringify(out, null, 2));
console.log(`  → wrote research/out/ls_lab.json\n`);
