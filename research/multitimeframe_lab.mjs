// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TIMEFRAME LAB (2026-07-11) — tests the central EMPIRICAL claim of the
// "Top-Down multi-timeframe" proposal: that layering monthly/weekly/daily momentum into
// a hierarchical stock score generates alpha. Scora's rule is measure-don't-assert, so
// before refactoring the core score we measure whether each horizon actually PREDICTS
// forward returns, and whether multi-timeframe CONFLUENCE beats a single horizon.
//
// Horizons (per name, each month t), all cross-sectional:
//   LONG   12-1m  (macro/structural trend — Scora's validated momentum factor)
//   MED     3-1m  (swing / medium-term)
//   SHORT   1m-0  (the most recent month — the "daily/tactical trigger" horizon)
// vs forward 1-month and 3-month returns → Spearman IC (avg monthly), split by the
// market-correlation regime (low/mid/high), plus a CONFLUENCE test (long-ranked, but only
// among names where MED and SHORT agree in sign) vs long alone.
//
// The key question the proposal gets wrong or right: does SHORT-term momentum CONTINUE
// (supporting a daily momentum trigger) or REVERSE (the documented 1-month reversal)?
// Run: node --experimental-strip-types --no-warnings research/multitimeframe_lab.mjs [--full N]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";
import { buildCorrEngine, corrAsOf } from "./correlation.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const FULL = process.argv.includes("--full");
const CAP = FULL ? (parseInt(process.argv[process.argv.indexOf("--full") + 1], 10) || 120) : 0;
const START = process.env.BT_START || "2010-01-01";
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Spearman rank correlation
function spearman(x, y) {
  const n = x.length; if (n < 4) return null;
  const rank = (arr) => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(n); for (let i = 0; i < n; i++) r[idx[i][1]] = i + 1; return r; };
  const rx = rank(x), ry = rank(y); let d2 = 0; for (let i = 0; i < n; i++) d2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -4));

let UNIVERSE = CURATED;
if (FULL) {
  try { const table = await loadSP500Historical(); const freq = new Map(); for (const d of dates) for (const t of membersAsOf(table, d) || []) freq.set(t, (freq.get(t) || 0) + 1); UNIVERSE = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP).map((e) => e[0]); }
  catch { UNIVERSE = CURATED; }
}
console.log(`\n  MULTI-TIMEFRAME LAB · ${UNIVERSE.length} names · ${dates.length} months ${dates[0]}→${dates.at(-1)}${FULL ? " · survivorship-free" : " · CURATED (survivorship-caveated)"}\n  loading prices…`);

// correlation regime buckets (same engine the score uses)
const corrEngine = await buildCorrEngine(UNIVERSE);
const corrByDate = new Map();
for (const d of dates) { const c = corrAsOf(corrEngine, UNIVERSE, d, 63); if (c != null) corrByDate.set(d, c); }
const corrVals = [...corrByDate.values()].sort((a, b) => a - b);
const loCut = corrVals[Math.floor(corrVals.length / 3)] ?? 0.3, hiCut = corrVals[Math.floor(2 * corrVals.length / 3)] ?? 0.5;
const regimeOf = (d) => { const c = corrByDate.get(d); return c == null ? null : c <= loCut ? "low" : c >= hiCut ? "high" : "mid"; };

// Per (date, name): the three momentum horizons + forward returns.
async function panel(date) {
  const rows = [];
  for (const t of UNIVERSE) {
    const long = await fwdReturn(t, addMonths(date, -12), addMonths(date, -1));
    const med = await fwdReturn(t, addMonths(date, -3), addMonths(date, -1));
    const short = await fwdReturn(t, addMonths(date, -1), date);
    const f1 = await fwdReturn(t, date, addMonths(date, 1));
    const f3 = await fwdReturn(t, date, addMonths(date, 3));
    if (long == null && med == null && short == null) continue;
    rows.push({ t, long, med, short, f1, f3 });
  }
  return rows;
}

// IC of a selector vs a forward field, averaged over months, by regime.
function icByRegime(panels, sel, fwd) {
  const buckets = { all: [], low: [], mid: [], high: [] };
  for (const { date, rows } of panels) {
    const g = rows.filter((r) => sel(r) != null && r[fwd] != null);
    if (g.length < 8) continue;
    const ic = spearman(g.map(sel), g.map((r) => r[fwd]));
    if (ic == null) continue;
    buckets.all.push(ic); const rg = regimeOf(date); if (rg) buckets[rg].push(ic);
  }
  return { all: mean(buckets.all), low: mean(buckets.low), mid: mean(buckets.mid), high: mean(buckets.high) };
}

const panels = [];
for (const date of dates) panels.push({ date, rows: await panel(date) });

const fmt = (v) => (v == null ? "  —  " : (v >= 0 ? "+" : "") + v.toFixed(3));
console.log(`\n  ── Cross-sectional IC (avg monthly Spearman, momentum horizon ↔ forward return) ──`);
console.log(`  ${"signal → fwd".padEnd(24)}${"IC all".padStart(9)}${"low-corr".padStart(10)}${"mid".padStart(8)}${"high".padStart(8)}`);
const report = {};
for (const [name, sel] of [["LONG 12-1m", (r) => r.long], ["MED 3-1m", (r) => r.med], ["SHORT 1m", (r) => r.short]]) {
  for (const fwd of ["f1", "f3"]) {
    const ic = icByRegime(panels, sel, fwd);
    report[`${name}→${fwd}`] = ic;
    console.log(`  ${(name + " → " + (fwd === "f1" ? "1m" : "3m")).padEnd(24)}${fmt(ic.all).padStart(9)}${fmt(ic.low).padStart(10)}${fmt(ic.mid).padStart(8)}${fmt(ic.high).padStart(8)}`);
  }
}

// CONFLUENCE: long-momentum rank, but restricted to names where MED & SHORT agree in sign
// with LONG (multi-timeframe aligned). Compare its IC vs plain LONG on the same months.
function confluenceIC(fwd) {
  const aligned = [], plain = [];
  for (const { date, rows } of panels) {
    const g = rows.filter((r) => r.long != null && r.med != null && r.short != null && r[fwd] != null);
    if (g.length < 10) continue;
    const conf = g.filter((r) => Math.sign(r.med) === Math.sign(r.long) && Math.sign(r.short) === Math.sign(r.long));
    if (conf.length >= 8) { const ic = spearman(conf.map((r) => r.long), conf.map((r) => r[fwd])); if (ic != null) aligned.push(ic); }
    const ip = spearman(g.map((r) => r.long), g.map((r) => r[fwd])); if (ip != null) plain.push(ip);
  }
  return { aligned: mean(aligned), plain: mean(plain) };
}
const cf1 = confluenceIC("f1"), cf3 = confluenceIC("f3");
report.confluence = { f1: cf1, f3: cf3 };
console.log(`\n  ── Multi-timeframe CONFLUENCE (LONG rank among MED+SHORT-aligned names) vs LONG alone ──`);
console.log(`  forward 1m:  confluence ${fmt(cf1.aligned)}  vs  long-alone ${fmt(cf1.plain)}`);
console.log(`  forward 3m:  confluence ${fmt(cf3.aligned)}  vs  long-alone ${fmt(cf3.plain)}`);

const verdict = (report["SHORT 1m→f1"].all ?? 0) < 0
  ? "SHORT-term (1m) momentum has NEGATIVE forward IC → it REVERSES, not continues. A daily/short momentum 'trigger' would fade winners; use short horizon as a REVERSAL/timing filter, not a continuation score."
  : "SHORT-term momentum IC is non-negative here (universe/period-specific) — treat with caution vs the documented 1-month reversal.";
console.log(`\n  VERDICT: ${verdict}`);
writeFileSync(join(OUT, FULL ? "multitimeframe_lab_full.json" : "multitimeframe_lab.json"), JSON.stringify({ generatedAt: new Date().toISOString(), universe: UNIVERSE.length, months: dates.length, survivorshipFree: FULL, report, verdict }, null, 2));
console.log(`  → wrote research/out/${FULL ? "multitimeframe_lab_full.json" : "multitimeframe_lab.json"}\n`);
